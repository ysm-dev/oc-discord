import { expect, it, vi } from "vitest";
import { Schema } from "effect";
import { mentioned } from "../../test/scenario.ts";
import { channelId } from "../../test/discord.ts";
import { session } from "../../test/opencode.ts";
import { catalog } from "../actions/catalog.ts";
import { installTools } from "./install.ts";

async function plugin(io?: Partial<Parameters<typeof installTools>[2]>) {
  const app = await mentioned();
  const tools = catalog.map(({ name, description, input }) => ({
    name,
    description,
    input: Schema.toJsonSchemaDocument(input).schema,
  }));
  await installTools(app.opencode.context(), tools, { ...app.opencode.io, ...io });
  await installTools(app.opencode.context(), tools, { ...app.opencode.io, ...io });
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) =>
    app.handler(new Request(input, init)),
  );
  return app;
}

it("plugin setup is repeatable; root and child Sessions use the root key and upload local files", async () => {
  const app = await plugin();
  expect(app.opencode.tools.size).toBe(11);
  app.opencode.files.set("plot.png", "PNG bytes");
  app.opencode.sessions.set("ses_child", session("ses_child", { parentID: "ses_1" }));
  const result = await app.opencode.call(
    "discord_send_message",
    { channel_id: channelId, content: "plot", files: ["plot.png", "/discord-bot/plot.png"] },
    "ses_child",
  );
  expect(result.content).toContain("Sent messages");
  expect(app.discord.calls.flatMap((call) => call.files)).toHaveLength(2);
  expect((await app.opencode.call("discord_list_channels", {})).content).toContain("general");
});

it("a missing upload names the absent file and sends nothing to Discord", async () => {
  const app = await plugin();
  await app.opencode.loadPlugin();
  await expect(
    app.opencode.call("discord_send_message", {
      channel_id: channelId,
      content: "Here is the image",
      files: ["missing.png"],
    }),
  ).rejects.toThrow(/ENOENT.*missing\.png/);
  expect(app.discord.calls.some((call) => call.method === "POST")).toBe(false);
});

it.each([
  ["../outside"],
  ["/outside"],
  ["a\\b"],
  [""],
  [12],
  Array.from({ length: 11 }, () => "x"),
])("the plugin rejects invalid file paths and counts (%#)", async (...files) => {
  const app = await plugin();
  await expect(
    app.opencode.call("discord_send_message", { channel_id: channelId, content: "x", files }),
  ).rejects.toThrow(/inside|strings|10 files/);
});

it("symlinks cannot escape the Session directory; file size is checked before and after reading", async () => {
  for (const io of [
    { canonical: (path: string) => Promise.resolve(path.endsWith("link") ? "/secret" : path) },
    { size: () => Promise.resolve(20 * 1024 * 1024 + 1) },
    { read: () => Promise.resolve(new Uint8Array(20 * 1024 * 1024 + 1)) },
  ]) {
    const app = await plugin(io);
    app.opencode.files.set("link", "file contents");
    await expect(
      app.opencode.call("discord_send_message", {
        channel_id: channelId,
        content: "x",
        files: ["link"],
      }),
    ).rejects.toThrow(/inside|20 MiB/);
  }
});

it("plugin calls reject Sessions without Bridge metadata and cyclic parents", async () => {
  const app = await plugin();
  for (const metadata of [
    {},
    { discord: null },
    { discord: [] },
    { discord: "x" },
    { discord: { bridgeUrl: 12 } },
    { discord: { bridgeUrl: "http://bridge.test", key: 1 } },
  ]) {
    app.opencode.sessions.set("ses_plain", session("ses_plain", { metadata }));
    await expect(app.opencode.call("discord_list_channels", {}, "ses_plain")).rejects.toThrow(
      "not started by oc-discord",
    );
  }
  app.opencode.sessions.set("ses_cycle", session("ses_cycle", { parentID: "ses_cycle" }));
  await expect(app.opencode.call("discord_list_channels", {}, "ses_cycle")).rejects.toThrow(
    "ancestry",
  );
});
