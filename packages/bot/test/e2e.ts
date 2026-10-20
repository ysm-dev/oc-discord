import { serve, spawnSync } from "bun";
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { REST } from "@discordjs/rest";
import { OpenCode as Client } from "@opencode/client";
import { Effect, Exit, Layer, Scope, Schema } from "effect";
import { HttpEffect } from "effect/http";
import { main } from "../src/main.ts";
import { Settings } from "../src/settings.ts";
import { OpenCode } from "../src/opencode/client.ts";
import { DiscordApi } from "../src/discord/api.ts";
import { Typing } from "../src/actions/typing.ts";
import { Log } from "../src/log.ts";
import { FakeDiscord, message } from "./discord.ts";
import { settings } from "./bridge.ts";
import { restResponse } from "./http.ts";
import { ScriptedModel } from "./e2e-model.ts";
import { artifact, scenarios } from "./e2e-scenarios.ts";

function docker(...args: string[]) {
  const result = spawnSync(["docker", ...args]);
  if (result.exitCode) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

let discord = new FakeDiscord();
const model = new ScriptedModel();
const edge = serve({
  hostname: "0.0.0.0",
  port: 0,
  async fetch(request) {
    if (!new URL(request.url).pathname.startsWith("/v1/")) {
      return discord.handle(request);
    }
    return model.respond(request);
  },
});

const password = randomUUID();
const container = `oc-discord-e2e-${randomUUID()}`;
const scope = await Effect.runPromise(Scope.make());
let bridgeServer: ReturnType<typeof serve> | undefined;
let handler = (_request: Request) => Promise.resolve(new Response("Starting", { status: 503 }));
try {
  docker(
    "run",
    "--rm",
    "-d",
    "--name",
    container,
    "--add-host",
    "host.docker.internal:host-gateway",
    "-e",
    `OPENCODE_PASSWORD=${password}`,
    "-p",
    "127.0.0.1::4096",
    "--entrypoint",
    "/bin/sh",
    "ghcr.io/anomalyco/opencode:2.0.32",
    "-c",
    "mkdir -p /discord-bot && exec opencode serve --hostname 0.0.0.0 --port 4096",
  );
  const address = docker("port", container, "4096/tcp");
  const client = Client.make({
    baseUrl: `http://${address}`,
    headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` },
  });
  let ready = false;
  for (let attempt = 0; attempt < 100 && !ready; attempt++) {
    try {
      await client.server.info();
      ready = true;
    } catch {
      await sleep(100);
    }
  }
  assert(ready, "OpenCode did not start");
  const location = { directory: "/discord-bot" };
  const rest = new REST({
    version: "10",
    makeRequest: (url, init) => {
      if (init.body != null && typeof init.body !== "string" && !(init.body instanceof FormData))
        throw new Error("Unsupported fake request body");
      return fetch(`http://127.0.0.1:${edge.port}${new URL(url).pathname}${new URL(url).search}`, {
        method: init.method!,
        ...(init.body ? { body: init.body } : {}),
      }).then(restResponse);
    },
  }).setToken("discord-secret");
  bridgeServer = serve({ hostname: "0.0.0.0", port: 0, fetch: (request) => handler(request) });
  const logs: string[] = [];
  const base = Layer.mergeAll(
    DiscordApi.layer(rest),
    OpenCode.layer(client, location.directory),
    Log.layer((line) => logs.push(line), [password]),
    Layer.succeed(Settings, {
      ...settings,
      bridgeUrl: `http://host.docker.internal:${bridgeServer.port}`,
    }),
  );
  const context = await Effect.runPromise(
    Layer.buildWithScope(Typing.layer.pipe(Layer.provideMerge(base)), scope),
  );
  const app = await Effect.runPromise(
    main.pipe(Effect.provideContext(context), Effect.provideService(Scope.Scope, scope)),
  );
  handler = HttpEffect.toWebHandler(app.app);
  const original = new TextDecoder().decode(
    await client.file.read({ location, path: "opencode.jsonc" }),
  );
  const config = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.JsonObject))(
    original.replace(/^\s*\/\/.*$/gm, ""),
  );
  await client.file.write({
    location,
    path: "opencode.jsonc",
    payload: new TextEncoder().encode(
      JSON.stringify({
        ...config,
        model: "scripted/model",
        providers: {
          scripted: {
            package: "@opencode/ai/providers/openai-compatible",
            settings: { baseURL: `http://host.docker.internal:${edge.port}/v1`, apiKey: "fake" },
            models: {
              model: { capabilities: { tools: true }, limit: { context: 100000, output: 10000 } },
            },
          },
        },
      }),
    ),
  });
  await client.file.write({
    location,
    path: "artifact.png",
    payload: artifact,
  });
  await client.location.reload();
  await Effect.runPromise(
    Effect.flatMap(OpenCode, (api) => api.ready).pipe(
      Effect.provide(OpenCode.layer(client, location.directory)),
    ),
  );
  const plugins = await client.plugin.list({ location });
  assert(
    plugins.data.some((plugin) => plugin.id === "oc-discord" && plugin.state.status === "active"),
    JSON.stringify(plugins),
  );
  let mentionId = 400000000000000100n;
  for (const scenario of scenarios()) {
    discord = scenario.discord;
    model.start(scenario.steps);
    const logStart = logs.length;
    const response: Response = await fetch(`http://127.0.0.1:${bridgeServer.port}/gateway`, {
      method: "POST",
      headers: { "x-discord-gateway-token": "discord-secret", "content-type": "application/json" },
      body: JSON.stringify({
        type: "GATEWAY_MESSAGE_CREATE",
        data: message({
          id: String(mentionId++),
          content: `<@100000000000000001> ${scenario.name}`,
        }),
        timestamp: Date.now(),
      }),
    });
    assert.equal(response.status, 200, scenario.name);
    for (
      let attempt = 0;
      attempt < 300 &&
      !logs
        .slice(logStart)
        .some((line) => line.includes("session.ended") || line.includes("session.failed"));
      attempt++
    )
      await sleep(100);
    model.finish();
    assert(
      logs.slice(logStart).some((line) => line.includes('"outcome":"succeeded"')),
      `${scenario.name}\n${logs.slice(logStart).join("\n")}`,
    );
    assert(![...discord.messages.values()].some((item) => item.content.includes("plain answer")));
    assert(!discord.calls.some((call) => JSON.stringify(call.body).includes("plain answer")));
    if (!scenario.steps.length)
      assert(
        discord.calls.every((call) => call.method === "GET"),
        "A plain answer has no Discord effects",
      );
    process.stdout.write(`E2E passed: ${scenario.name}\n`);
  }
  model.finishSuite();
  process.stdout.write(
    "E2E passed: real OpenCode v2, all eleven direct tools, no question, and no automatic reply.\n",
  );
} catch (error) {
  process.stderr.write(`${docker("logs", container)}\n`);
  throw error;
} finally {
  await Effect.runPromise(Scope.close(scope, Exit.void));
  await bridgeServer?.stop(true);
  await edge.stop(true);
  docker("rm", "-f", container);
}
