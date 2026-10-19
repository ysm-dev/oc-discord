import { Clock, Effect } from "effect";
import { Log } from "../log.ts";
import type { ReceivingAdapter } from "./adapter.ts";
import { Gateway } from "./receive.ts";

export const superviseGateway = Effect.fnUntraced(function* (
  adapter: ReceivingAdapter,
  url: string,
) {
  const gateway = yield* Gateway;
  const log = yield* Log;
  const duration = 2_147_483_647;
  let backoff = 1000;
  while (true) {
    const started = yield* Clock.currentTimeMillis;
    yield* Effect.tryPromise((signal) => gateway.listen(adapter, duration, signal, url)).pipe(
      Effect.catch(() => Effect.sync(() => log.write("gateway.failed"))),
    );
    const elapsed = (yield* Clock.currentTimeMillis) - started;
    if (elapsed < duration) {
      log.write("gateway.reconnecting", { delayMs: backoff });
      yield* Effect.sleep(backoff);
      backoff = Math.min(backoff * 2, 60_000);
    } else backoff = 1000;
  }
});
