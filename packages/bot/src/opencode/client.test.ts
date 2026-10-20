import { it, assert } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { FakeOpenCode } from "../../test/opencode.ts";
import { OpenCode } from "./client.ts";

it.effect("startup waits until OpenCode finishes loading the installed plugin", () =>
  Effect.gen(function* () {
    const fake = new FakeOpenCode();
    fake.pluginDelay = 2;
    const fiber = yield* Effect.forkChild(
      Effect.flatMap(OpenCode, (api) => api.ready).pipe(
        Effect.provide(OpenCode.layer(fake.client, "/discord-bot")),
      ),
    );
    yield* TestClock.adjust(200);
    yield* Fiber.join(fiber);
    assert.lengthOf(
      fake.requests.filter((request) => request.url.includes("/api/plugin")),
      3,
    );
  }),
);

it.effect.each(["failed", "missing"] as const)(
  "startup reports a %s plugin rather than receiving unusable Mentions",
  (state) =>
    Effect.gen(function* () {
      const fake = new FakeOpenCode();
      fake.pluginState = state;
      const result = Effect.flatMap(OpenCode, (api) => api.ready).pipe(
        Effect.provide(OpenCode.layer(fake.client, "/discord-bot")),
        Effect.flip,
      );
      const fiber = yield* Effect.forkChild(result);
      yield* TestClock.adjust(10_000);
      const error = yield* Fiber.join(fiber);
      assert.match(error.message, /could not load|did not load/);
    }),
);
