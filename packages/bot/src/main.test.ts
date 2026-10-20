import { afterEach, expect, it, vi } from "vitest";
import { Schema } from "effect";
import { bridge } from "../test/bridge.ts";
import { bot, channelId, guildId, message, threadId } from "../test/discord.ts";

const running: Awaited<ReturnType<typeof bridge>>[] = [];
async function start() {
  const app = await bridge();
  running.push(app);
  return app;
}
afterEach(async () => {
  for (const app of running.splice(0)) await app.close();
  vi.unstubAllGlobals();
});

it("Alice mentions the Bot → a fresh Session receives the Briefing → only Actions reach Discord", async () => {
  const app = await start();
  expect((await app.mention()).status).toBe(200);
  await vi.waitFor(() => expect(app.opencode.prompts.size).toBe(1));
  expect(app.opencode.prompts.get("ses_1")).toContain("Server: Our server");
  expect(app.opencode.prompts.get("ses_1")).toContain("Earlier conversation");
  expect(app.opencode.prompts.get("ses_1")).toContain(`@Bridge (id ${bot.id}) hello`);
  expect(app.opencode.sessions.get("ses_1")?.title).toContain("#general · alice:");
  expect(app.discord.calls.every((call) => call.method === "GET")).toBe(true);
  await app.opencode.loadPlugin();
  expect(app.opencode.tools.size).toBe(11);
  expect([...app.opencode.tools.values()].every((tool) => !tool.options.codemode)).toBe(true);
  vi.stubGlobal("fetch", (input: string | Request | URL, init?: RequestInit) =>
    app.handler(new Request(input, init)),
  );
  await app.opencode.call("discord_typing", { channel_id: channelId });
  const sent = await app.opencode.call("discord_send_message", {
    channel_id: channelId,
    content: "Hello, Alice!",
    reply_to: message().id,
  });
  expect(sent.content).toContain("Sent messages:");
  expect([...app.discord.messages.values()].at(-1)?.content).toBe("Hello, Alice!");
  app.opencode.finish("ses_1", "succeeded");
  await vi.waitFor(() => expect(app.logs.join("\n")).toContain('"outcome":"succeeded"'));
  expect(app.logs.join("\n")).not.toMatch(
    /Earlier conversation|hello|Hello, Alice|discord-secret|password-secret/,
  );
  expect(app.opencode.sessions.size).toBe(1);
});

it("simultaneous Mentions in one channel each start immediately; repeated delivery starts only one Session", async () => {
  const app = await start();
  await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      app.mention(message({ id: String(400000000000000010n + BigInt(index)) })),
    ),
  );
  await app.mention(message({ id: "400000000000000010" }));
  await vi.waitFor(() => expect(app.opencode.prompts.size).toBe(12));
  const keys = [...app.opencode.sessions.values()].map((session) =>
    JSON.stringify(session.metadata),
  );
  expect(new Set(keys).size).toBe(12);
});

it("edits, DMs, bots, role and global pings, and unmentioned messages never start Sessions", async () => {
  const app = await start();
  const { guild_id: _guild, ...dm } = message();
  await Promise.all([
    app.mention(message(), "GATEWAY_MESSAGE_UPDATE"),
    app.mention(dm),
    app.mention(message({ author: bot })),
    app.mention(message({ content: "@everyone @here <@&123> @bridge", mentions: [] })),
  ]);
  expect(app.opencode.sessions.size).toBe(0);
});

it("a reply ping counts even without a typed mention; a thread includes its starter", async () => {
  const app = await start();
  app.discord.messages.set(
    threadId,
    message({ id: threadId, content: "Thread starter", mentions: [] }),
  );
  await app.mention(
    message({
      channel_id: threadId,
      content: "Please elaborate",
      message_reference: { message_id: "123" },
    }),
  );
  await vi.waitFor(() => expect(app.opencode.prompts.size).toBe(1));
  expect(app.opencode.prompts.get("ses_1")).toContain("Thread: discussion");
  expect(app.opencode.prompts.get("ses_1")).toContain("Thread starter:\n");
  expect(app.opencode.prompts.get("ses_1")).toContain("reply to 123");
  expect(app.opencode.sessions.get("ses_1")?.metadata?.["discord"]).toMatchObject({
    guildId,
    channelId,
    threadId,
  });
});

it("an Action cannot cross servers, use another Session's key, or change someone else's message", async () => {
  const app = await start();
  await app.mention();
  await vi.waitFor(() => expect(app.opencode.prompts.size).toBe(1));
  app.discord.channels.set("999", { id: "999", guild_id: "888", type: 0, name: "private" });
  expect(
    (await app.action("discord_send_message", { channel_id: "999", content: "leak" })).status,
  ).toBe(403);
  expect((await app.action("discord_list_channels", {}, "ses_1", "wrong")).status).toBe(401);
  expect(
    (
      await app.action("discord_delete_message", {
        channel_id: channelId,
        message_id: "400000000000000000",
      })
    ).status,
  ).toBe(403);
  expect(app.discord.calls.some((call) => call.method === "POST")).toBe(false);
});

it("startup reinstalls the plugin but preserves operator-owned files", async () => {
  const first = await start();
  expect(first.opencode.files.get("AGENTS.md")).toContain(
    "Keep replies concise; add detail when someone asks for it.",
  );
  const config = first.opencode.files.get("opencode.jsonc")!;
  expect(
    Schema.decodeUnknownSync(Schema.fromJsonString(Schema.JsonObject))(
      config.replace(/^\s*\/\/.*$/gm, ""),
    ),
  ).toEqual({
    $schema: "https://opencode.ai/config.json",
    model: "opencode-go/deepseek-v4.1-flash",
    permissions: [
      { action: "question", resource: "*", effect: "deny" },
      { action: "read", resource: "*.env", effect: "deny" },
      { action: "read", resource: "*.env.*", effect: "deny" },
      { action: "read", resource: "*.env.example", effect: "allow" },
      { action: "external_directory", resource: "*", effect: "deny" },
    ],
  });
  const instructions = first.opencode.files.get("AGENTS.md");
  first.opencode.files.set("AGENTS.md", "My instructions");
  first.opencode.files.set("opencode.jsonc", "My settings");
  first.opencode.files.set(".opencode/plugins/oc-discord.ts", "outdated");
  const second = await bridge(first.discord, first.opencode);
  running.push(second);
  expect(second.opencode.files.get("AGENTS.md")).toBe("My instructions");
  expect(second.opencode.files.get("opencode.jsonc")).toBe("My settings");
  expect(second.opencode.files.get(".opencode/plugins/oc-discord.ts")).toContain("Plugin.define");
  second.opencode.files.delete("AGENTS.md");
  const third = await bridge(first.discord, first.opencode);
  running.push(third);
  expect(third.opencode.files.get("AGENTS.md")).toBe(instructions);
  expect(third.opencode.files.get("opencode.jsonc")).toBe("My settings");
  third.opencode.files.delete("opencode.jsonc");
  const fourth = await bridge(first.discord, first.opencode);
  running.push(fourth);
  expect(fourth.opencode.files.get("opencode.jsonc")).toBe(config);
});
