import { expect, it } from "vitest";
import { Effect } from "effect";
import { mentioned, scenario } from "../../test/scenario.ts";
import { channelId } from "../../test/discord.ts";
import { DiscordApi } from "../discord/api.ts";
import { HttpClientRequest, HttpServerRequest } from "effect/http";

it("HTTP accepts only authenticated Gateway forwarding and authenticated Session Actions", async () => {
  const app = await scenario();
  const request = (
    path: string,
    method = "POST",
    headers: Record<string, string> = {},
    body = "{}",
  ) =>
    app.handler(
      new Request(`http://bridge.test${path}`, {
        method,
        headers,
        ...(method === "POST" ? { body } : {}),
      }),
    );
  expect((await request("/gateway")).status).toBe(401);
  expect((await request("/gateway", "GET")).status).toBe(405);
  expect((await request("/interactions")).status).toBe(404);
  expect((await request("/actions/ses_1")).status).toBe(401);
  expect(
    (await request("/gateway", "POST", { "x-discord-gateway-token": "discord-secret" }, "not JSON"))
      .status,
  ).toBe(200);
  expect(app.opencode.sessions.size).toBe(0);
});

it("Action errors explain bad input without reflecting payloads or upstream response bodies", async () => {
  const app = await mentioned();
  expect((await app.action("not_an_action", {})).status).toBe(400);
  expect(
    (await app.action("discord_send_message", { channel_id: "../outside", content: "PRIVATE" }))
      .status,
  ).toBe(400);
  for (const status of [403, 404, 400]) {
    app.discord.failures.set(`/channels/${channelId}`, status);
    const response = await app.action("discord_typing", { channel_id: channelId });
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain("SECRET");
  }
  app.discord.failures.clear();
  app.discord.malformed = true;
  expect(await (await app.action("discord_typing", { channel_id: channelId })).text()).toContain(
    "invalid response",
  );
});

it("file uploads arrive as bytes and reject invalid, oversized, or excessive files", async () => {
  const app = await mentioned();
  const key = app.opencode.key("ses_1");
  const upload = (files: (Blob | string)[]) => {
    const form = new FormData();
    form.set(
      "call",
      JSON.stringify({
        name: "discord_send_message",
        args: { channel_id: channelId, content: "" },
      }),
    );
    files.forEach((file) => {
      if (typeof file === "string") form.append("files", file);
      else form.append("files", file, "image.png");
    });
    return app.handler(
      new Request("http://bridge.test/actions/ses_1", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body: form,
      }),
    );
  };
  expect((await upload([new Blob(["image bytes"])])).status).toBe(200);
  const posted = app.discord.calls.find((call) => call.files.length > 0);
  expect(await posted?.files[0]?.text()).toBe("image bytes");
  for (const files of [
    ["not a file"],
    Array.from({ length: 11 }, () => new Blob(["x"])),
    [new Blob([new Uint8Array(20 * 1024 * 1024 + 1)])],
  ]) {
    expect((await upload(files)).status).toBe(400);
  }
  const invalid = await app.handler(
    new Request("http://bridge.test/actions/ses_1", {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
      body: "not multipart",
    }),
  );
  expect(await invalid.text()).toContain("multipart form data");
});

it("the outgoing Discord API enforces file limits for every caller", async () => {
  const app = await scenario();
  const api = Effect.runSync(DiscordApi.pipe(Effect.provideContext(app.context)));
  const oversized = [{ name: "large.bin", data: new Uint8Array(20 * 1024 * 1024 + 1) }];
  const excessive = Array.from({ length: 11 }, () => ({ name: "x", data: new Uint8Array() }));
  for (const files of [oversized, excessive])
    await expect(Effect.runPromise(api.send(channelId, "file", undefined, files))).rejects.toThrow(
      "at most 10 files",
    );
  expect(app.discord.messages.size).toBe(1);
  expect(app.discord.calls.some((call) => call.method === "POST")).toBe(false);
});

it("a malformed URL at the HTTP adapter boundary returns a plain error", async () => {
  const app = await scenario();
  const response = await Effect.runPromise(
    app.effect.pipe(
      Effect.provideService(
        HttpServerRequest.HttpServerRequest,
        HttpServerRequest.fromClientRequest(
          HttpClientRequest.post("/", { headers: { host: "[invalid" } }),
        ),
      ),
      Effect.scoped,
    ),
  );
  expect(response.status).toBe(400);
});
