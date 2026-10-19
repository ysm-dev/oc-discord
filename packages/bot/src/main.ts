import { Effect, Scope } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { DiscordApi } from "./discord/api.ts";
import { setupDirectory } from "./opencode/setup.ts";
import { makeSessions } from "./sessions/sessions.ts";
import { makeReceiver } from "./receiving/receive.ts";
import { handleAction } from "./actions/http.ts";
import { Log } from "./log.ts";
import { BridgeError } from "./errors.ts";

export const main = Effect.gen(function* () {
  yield* setupDirectory;
  const api = yield* DiscordApi;
  const identity = yield* api.identity;
  const startSession = yield* makeSessions(identity.bot);
  const context = yield* Effect.context<Effect.Services<ReturnType<typeof startSession>>>();
  const scope = yield* Scope.Scope;
  const receiver = yield* makeReceiver(identity.bot, identity.application, (mention) => {
    Effect.runForkWith(context)(startSession(mention).pipe(Effect.forkIn(scope)));
  });
  const dependencies = yield* Effect.context<Effect.Services<ReturnType<typeof handleAction>>>();
  const app = Effect.gen(function* () {
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    const request = yield* HttpServerRequest.toWeb(incoming);
    const path = new URL(request.url).pathname;
    if (request.method !== "POST") return HttpServerResponse.empty({ status: 405 });
    if (path === "/gateway") return HttpServerResponse.fromWeb(yield* receiver.handle(request));
    const match = /^\/actions\/(ses[^/]+)$/.exec(path);
    if (!match) return HttpServerResponse.empty({ status: 404 });
    return yield* handleAction(request, match[1]!, identity.bot.id).pipe(
      Effect.provideContext(dependencies),
    );
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        HttpServerResponse.text(
          error instanceof BridgeError ? error.message : "Invalid HTTP request",
          { status: error instanceof BridgeError ? Math.min(error.status, 599) : 400 },
        ),
      ),
    ),
  );
  const log = yield* Log;
  log.write("bridge.ready", { botId: identity.bot.id });
  return { app, adapter: receiver.adapter };
});
