import { expect, it, vi } from "vitest";
import { bridge } from "../../test/bridge.ts";
import { mentioned, scenario } from "../../test/scenario.ts";
import { FakeDiscord, channelId, message, threadId } from "../../test/discord.ts";
import { FakeOpenCode, session } from "../../test/opencode.ts";

it("stopping the Bridge leaves Sessions running; root and child Actions authenticate after restart", async () => {
  const first = await mentioned();
  const key = first.opencode.key("ses_1");
  await first.close();
  const restarted = await scenario(first.discord, first.opencode);
  restarted.opencode.sessions.set("ses_child", session("ses_child", { parentID: "ses_1" }));
  expect(
    (
      await restarted.action(
        "discord_send_message",
        { channel_id: channelId, content: "Resumed" },
        "ses_child",
        key,
      )
    ).status,
  ).toBe(200);
  expect(restarted.opencode.requests.some((request) => /interrupt|DELETE/.test(request.url))).toBe(
    false,
  );
  expect(restarted.opencode.sessions.size).toBe(2);
});

it("Sessions without Bridge metadata, cycles and keys of the wrong size are rejected", async () => {
  const app = await mentioned();
  app.opencode.sessions.set("ses_plain", session("ses_plain"));
  app.opencode.sessions.set("ses_cycle", session("ses_cycle", { parentID: "ses_cycle" }));
  for (const id of ["ses_plain", "ses_cycle"])
    expect((await app.action("discord_list_channels", {}, id, "key")).status).toBe(403);
  expect((await app.action("discord_list_channels", {}, "ses_1", "x".repeat(64))).status).toBe(401);
  expect((await app.action("discord_list_channels", {}, "ses_missing", "key")).status).toBe(404);
});

it.each(["failed", "interrupted"] as const)(
  "Session outcome %s is logged, never posted",
  async (outcome) => {
    const app = await mentioned();
    app.opencode.finish("ses_1", outcome);
    app.opencode.emit("session.execution.succeeded", { sessionID: "ses_untracked" });
    await vi.waitFor(() => expect(app.logs.join("\n")).toContain(`"outcome":"${outcome}"`));
    expect(app.logs.join("\n")).not.toContain("PRIVATE text");
    expect(app.discord.calls.every((call) => call.method === "GET")).toBe(true);
  },
);

it("a dropped event stream reconnects and catches up on missed outcomes", async () => {
  const app = await mentioned();
  app.opencode.disconnect();
  app.opencode.finish("ses_1", "failed");
  await vi.waitFor(() => expect(app.logs.join("\n")).toContain("Recovered failure"), {
    timeout: 2500,
  });
  expect(app.opencode.connections).toBeGreaterThan(1);
});

it("an event transport failure reconnects; running Sessions remain tracked and successful outcomes are recovered", async () => {
  const app = await mentioned();
  app.opencode.emit("server.connected", {});
  await vi.waitFor(() =>
    expect(
      app.opencode.requests.some(
        (request) => new URL(request.url).pathname === "/api/session/ses_1",
      ),
    ).toBe(true),
  );
  app.opencode.disconnect(true);
  app.opencode.finish("ses_1", "succeeded");
  await vi.waitFor(() => expect(app.logs.join("\n")).toContain('"outcome":"succeeded"'), {
    timeout: 2500,
  });
  expect(app.logs.join("\n")).toContain("opencode.events.failed");
  expect(app.logs.join("\n")).not.toContain("PRIVATE");
});

it("provider failures without an HTTP status still produce an outcome log", async () => {
  const app = await mentioned();
  app.opencode.emit("session.permissions", { sessionID: "ses_1", permissions: [] });
  app.opencode.emit("session.execution.failed", {
    sessionID: "ses_1",
    error: { type: "ProviderError", message: "PRIVATE" },
  });
  await vi.waitFor(() => expect(app.logs.join("\n")).toContain("provider error"));
});

it("Briefing and prompt failures are logged with IDs and do not post error messages", async () => {
  const app = await scenario();
  app.discord.failures.set(`/channels/${channelId}`, 403);
  await app.mention();
  await vi.waitFor(() => expect(app.logs.join("\n")).toContain("session.failed"));
  app.discord.failures.clear();
  app.opencode.failures.set("/api/session/ses_1/prompt", 503);
  await app.mention(message({ id: "400000000000000002" }));
  await vi.waitFor(() =>
    expect(app.logs.filter((line) => line.includes("session.failed"))).toHaveLength(2),
  );
  expect(app.logs.join("\n")).toContain("messageId");
  expect(app.discord.calls.every((call) => call.method === "GET")).toBe(true);
});

it("a deleted thread starter is tolerated; other errors remain visible", async () => {
  const app = await scenario();
  await app.mention(message({ channel_id: threadId }));
  await vi.waitFor(() => expect(app.opencode.prompts.size).toBe(1));
  expect(app.opencode.prompts.get("ses_1")).not.toContain("Thread starter:");
  app.discord.failures.set(`/channels/${channelId}/messages/${threadId}`, 403);
  await app.mention(message({ channel_id: threadId, id: "400000000000000002" }));
  await vi.waitFor(() => expect(app.logs.join("\n")).toContain("session.failed"));
});

it.each(["v1", "password", "directory", "token"])(
  "startup rejects bad %s configuration",
  async (kind) => {
    const discord = new FakeDiscord();
    const opencode = new FakeOpenCode();
    if (kind === "v1") opencode.version = "1.19.3";
    if (kind === "password") opencode.failures.set("/api/info", 401);
    if (kind === "directory") opencode.failures.set("/api/location", 404);
    if (kind === "token") discord.failures.set("/users/@me", 401);
    await expect(bridge(discord, opencode)).rejects.toThrow(
      kind === "directory"
        ? "Session directory"
        : kind === "v1"
          ? "v2 is required"
          : "check credentials",
    );
  },
);
