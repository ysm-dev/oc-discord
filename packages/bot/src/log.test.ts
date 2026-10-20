import { Effect } from "effect";
import { expect, it } from "vitest";
import { Log } from "./log.ts";
import { networkError } from "./errors.ts";

it("logs redact secrets and discard Chat SDK's message text and payload arguments", async () => {
  const output: string[] = [];
  await Effect.runPromise(
    Effect.gen(function* () {
      const log = yield* Log;
      log.write("session.failed", { error: "secret token" });
      const child = log.chat.child("private channel name");
      child.info("private text", { content: "PRIVATE" });
      child.debug("private text");
      child.warn("private text", "secret");
      child.error("private text", { token: "token" });
    }).pipe(Effect.provide(Log.layer((line) => output.push(line), ["secret", "token"]))),
  );
  expect(output.join("\n")).toContain("[redacted]");
  expect(output.join("\n")).not.toMatch(/private|PRIVATE|secret|token/);
});

it("external errors expose actionable status hints without reflecting response bodies", () => {
  expect(networkError("Discord", { status: 429, message: "PRIVATE" }).message).toContain(
    "rate limited",
  );
  expect(networkError("OpenCode", new Error("secret")).message).toBe(
    "OpenCode: request failed (HTTP 502)",
  );
  expect(networkError("OpenCode", null).status).toBe(502);
  expect(networkError("OpenCode", { cause: { status: 503 } }).status).toBe(503);
});
