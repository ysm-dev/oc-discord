import { it, assert } from "@effect/vitest";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { ReceivingAdapter } from "./adapter.ts";
import { Gateway } from "./receive.ts";
import { superviseGateway } from "./supervise.ts";
import { Log } from "../log.ts";

it.effect(
  "the Gateway is supervised with bounded timer durations and backoff after early exits",
  () =>
    Effect.gen(function* () {
      const context = yield* Effect.context();
      const durations: number[] = [];
      const logs: string[] = [];
      const gateway = Gateway.layer((_adapter, duration, signal) => {
        durations.push(duration);
        const count = durations.length;
        const work =
          count === 1
            ? Effect.fail(new Error("login failed"))
            : count === 3
              ? Effect.sleep(duration)
              : count < 5
                ? Effect.void
                : Effect.never;
        return Effect.runPromiseWith(context)(work, { signal });
      });
      const adapter = new ReceivingAdapter({
        botToken: "token",
        applicationId: "123",
        publicKey: "a".repeat(64),
      });
      const fiber = yield* Effect.forkChild(
        superviseGateway(adapter, "http://bridge/gateway").pipe(
          Effect.provide(
            Layer.merge(
              gateway,
              Log.layer((line) => logs.push(line), []),
            ),
          ),
        ),
      );
      yield* TestClock.adjust(1000);
      assert.lengthOf(durations, 2);
      yield* TestClock.adjust(2000);
      assert.lengthOf(durations, 3);
      yield* TestClock.adjust(2_147_483_647);
      assert.lengthOf(durations, 4);
      yield* TestClock.adjust(1000);
      assert.lengthOf(durations, 5);
      assert.deepEqual(new Set(durations), new Set([2_147_483_647]));
      assert.include(logs.join("\n"), "gateway.failed");
      yield* Fiber.interrupt(fiber);
    }),
);
