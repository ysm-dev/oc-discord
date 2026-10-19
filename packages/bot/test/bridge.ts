import { Effect, Exit, Layer, Redacted, Scope } from "effect";
import { HttpEffect } from "effect/http";
import { main } from "../src/main.ts";
import { DiscordApi } from "../src/discord/api.ts";
import { OpenCode } from "../src/opencode/client.ts";
import { Settings, type SettingsValue } from "../src/settings.ts";
import { Typing } from "../src/actions/typing.ts";
import { Log } from "../src/log.ts";
import { FakeDiscord, message } from "./discord.ts";
import { FakeOpenCode } from "./opencode.ts";
import type { Message } from "../src/discord/models.ts";

export const settings: SettingsValue = {
  opencodeUrl: "http://opencode.test",
  password: Redacted.make("password-secret"),
  token: Redacted.make("discord-secret"),
  directory: "/discord-bot",
  bridgeUrl: "http://bridge.test",
  history: 50,
  host: "127.0.0.1",
  port: 4097,
};

export async function bridge(
  discord = new FakeDiscord(),
  opencode = new FakeOpenCode(),
  overrides: Partial<SettingsValue> = {},
) {
  const logs: string[] = [];
  const scope = await Effect.runPromise(Scope.make());
  const base = Layer.mergeAll(
    DiscordApi.layer(discord.client()),
    OpenCode.layer(opencode.client, "/discord-bot"),
    Log.layer((line) => logs.push(line), ["password-secret", "discord-secret"]),
    Layer.succeed(Settings, { ...settings, ...overrides }),
  );
  const layer = Typing.layer.pipe(Layer.provideMerge(base));
  const context = await Effect.runPromise(Layer.buildWithScope(layer, scope));
  let running;
  try {
    running = await Effect.runPromise(
      main.pipe(Effect.provideContext(context), Effect.provideService(Scope.Scope, scope)),
    );
  } catch (error) {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    throw error;
  }
  const handler = HttpEffect.toWebHandler(running.app);
  return {
    discord,
    opencode,
    logs,
    handler,
    context,
    scope,
    effect: running.app,
    close: async () => {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    },
    mention: (item: Message = message(), type = "GATEWAY_MESSAGE_CREATE") =>
      handler(
        new Request("http://bridge.test/gateway", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-discord-gateway-token": "discord-secret",
          },
          body: JSON.stringify({ type, data: item, timestamp: Date.now() }),
        }),
      ),
    action: (name: string, args: Record<string, SchemaJson>, sessionId = "ses_1", key?: string) => {
      const secret = key ?? opencode.key(sessionId);
      const body = new FormData();
      body.set("call", JSON.stringify({ name, args }));
      return handler(
        new Request(`http://bridge.test/actions/${sessionId}`, {
          method: "POST",
          headers: { authorization: `Bearer ${secret}` },
          body,
        }),
      );
    },
  };
}

type SchemaJson = import("effect").Schema.Json;
