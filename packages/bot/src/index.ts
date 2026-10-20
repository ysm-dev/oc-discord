#!/usr/bin/env bun
import process from "node:process";
import { BunHttpServer, BunRuntime, BunServices } from "@effect/platform-bun";
import { REST } from "@discordjs/rest";
import { OpenCode as Client } from "@opencode/client";
import { Effect, Layer, Redacted } from "effect";
import { main } from "./main.ts";
import { cli, Settings } from "./settings.ts";
import { DiscordApi } from "./discord/api.ts";
import { OpenCode } from "./opencode/client.ts";
import { Log } from "./log.ts";
import { Typing } from "./actions/typing.ts";
import { Gateway } from "./receiving/receive.ts";
import { superviseGateway } from "./receiving/supervise.ts";
import { BridgeError } from "./errors.ts";

cli((settings) => {
  const base = Layer.mergeAll(
    Layer.succeed(Settings, settings),
    Log.layer(
      (line) => process.stdout.write(`${line}\n`),
      [Redacted.value(settings.password), Redacted.value(settings.token)],
    ),
    Gateway.layer(async (adapter, duration, signal, url) => {
      let done = Promise.resolve();
      await adapter.startGatewayListener(
        {
          waitUntil: (promise) => {
            done = promise.then(() => undefined);
          },
        },
        duration,
        signal,
        url,
      );
      await done;
    }),
  );
  const network = Layer.mergeAll(
    DiscordApi.layer(new REST({ version: "10" }).setToken(Redacted.value(settings.token))),
    OpenCode.layer(
      Client.make({
        baseUrl: settings.opencodeUrl,
        headers: {
          authorization: `Basic ${Buffer.from(`opencode:${Redacted.value(settings.password)}`).toString("base64")}`,
        },
      }),
      settings.directory,
    ),
  ).pipe(Layer.provideMerge(base));
  const services = Typing.layer.pipe(Layer.provideMerge(network));
  return Effect.scoped(
    Effect.gen(function* () {
      const bridge = yield* main;
      const server = yield* BunHttpServer.make({
        hostname: settings.host,
        port: settings.port,
        maxRequestBodySize: 211 * 1024 * 1024,
        idleTimeout: 0,
      });
      yield* server.serve(bridge.app);
      const host = settings.host === "0.0.0.0" ? "127.0.0.1" : settings.host;
      yield* superviseGateway(bridge.adapter, `http://${host}:${settings.port}/gateway`);
    }),
  ).pipe(
    Effect.provide(services),
    Effect.catch((error) =>
      Effect.sync(() => {
        process.stderr.write(
          `${error instanceof BridgeError ? error.message : "Bridge HTTP server failed to start; check --host and --port"}\n`,
        );
        process.exitCode = 1;
      }),
    ),
  );
}).pipe(Effect.provide(BunServices.layer), BunRuntime.runMain);
