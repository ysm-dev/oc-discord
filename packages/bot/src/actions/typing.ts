import { Context, Effect, Fiber, Layer, Scope, Semaphore } from "effect";
import { DiscordApi } from "../discord/api.ts";
import { Log } from "../log.ts";

export class Typing extends Context.Service<
  Typing,
  {
    start: (
      sessionId: string,
      channelId: string,
    ) => Effect.Effect<void, import("../errors.ts").BridgeError>;
    posted: (channelId: string) => Effect.Effect<void>;
    ended: (sessionId: string) => Effect.Effect<void>;
  }
>()("oc-discord/Typing") {
  static readonly layer = Layer.effect(
    Typing,
    Effect.gen(function* () {
      const api = yield* DiscordApi;
      const log = yield* Log;
      const scope = yield* Scope.Scope;
      const mutex = yield* Semaphore.make(1);
      const channels = new Map<string, { sessions: Set<string>; fiber: Fiber.Fiber<void> }>();
      const stop = Effect.fnUntraced(function* (channelId: string) {
        const channel = channels.get(channelId);
        if (channel) {
          channels.delete(channelId);
          yield* Fiber.interrupt(channel.fiber);
        }
      });
      return {
        start: Effect.fnUntraced(function* (sessionId, channelId) {
          const existing = channels.get(channelId);
          if (existing) {
            existing.sessions.add(sessionId);
            return;
          }
          yield* api.typing(channelId);
          const renew = Effect.gen(function* () {
            while (true) {
              yield* Effect.sleep("8 seconds");
              yield* api
                .typing(channelId)
                .pipe(
                  Effect.catch((error) =>
                    Effect.sync(() =>
                      log.write("typing.failed", { channelId, error: error.message }),
                    ),
                  ),
                );
            }
          });
          const fiber = yield* Effect.forkIn(renew, scope);
          channels.set(channelId, { sessions: new Set([sessionId]), fiber });
        }, Semaphore.withPermit(mutex)),
        posted: (channelId) => mutex.withPermit(stop(channelId)),
        ended: Effect.fnUntraced(function* (sessionId) {
          for (const [channelId, state] of channels) {
            state.sessions.delete(sessionId);
            if (state.sessions.size === 0) yield* stop(channelId);
          }
        }, Semaphore.withPermit(mutex)),
      };
    }),
  );
}
