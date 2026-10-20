import { randomBytes } from "node:crypto";
import { Effect, Stream } from "effect";
import { buildBriefing } from "../briefing/build.ts";
import type { Message, User } from "../discord/models.ts";
import { OpenCode } from "../opencode/client.ts";
import { Settings } from "../settings.ts";
import { Log } from "../log.ts";
import { Typing } from "../actions/typing.ts";
import type { Metadata } from "./metadata.ts";

export const makeSessions = Effect.fnUntraced(function* (bot: User) {
  const opencode = yield* OpenCode;
  const settings = yield* Settings;
  const log = yield* Log;
  const typing = yield* Typing;
  const tracked = new Map<string, Metadata>();
  const finish = Effect.fnUntraced(function* (
    sessionId: string,
    outcome: string,
    error: string = "",
  ) {
    const metadata = tracked.get(sessionId);
    yield* typing.ended(sessionId);
    if (!metadata) return;
    tracked.delete(sessionId);
    log.write("session.ended", {
      sessionId,
      guildId: metadata.guildId,
      channelId: metadata.channelId,
      messageId: metadata.messageId,
      outcome,
      error,
    });
  });
  const catchUp = Effect.fnUntraced(function* () {
    for (const sessionId of tracked.keys()) {
      const session = yield* opencode.get(sessionId);
      if (session.outcome)
        yield* finish(
          sessionId,
          session.outcome,
          session.outcome === "failed" ? "Recovered failure; inspect Session in OpenCode" : "",
        );
    }
  });
  const watch = Effect.gen(function* () {
    while (true) {
      yield* opencode.events().pipe(
        Stream.runForEach((event) => {
          switch (event.type) {
            case "server.connected":
              return catchUp();
            case "session.execution.succeeded":
              return finish(event.data.sessionID, "succeeded");
            case "session.execution.interrupted":
              return finish(event.data.sessionID, "interrupted", event.data.reason);
            case "session.execution.failed":
              return finish(
                event.data.sessionID,
                "failed",
                `Execution failed (${event.data.error.status ?? "provider error"}); inspect Session in OpenCode`,
              );
            default:
              return Effect.void;
          }
        }),
        Effect.catch((error) =>
          Effect.sync(() => log.write("opencode.events.failed", { error: error.message })),
        ),
      );
      yield* Effect.sleep("1 second");
    }
  });
  yield* Effect.forkScoped(watch);
  return Effect.fnUntraced(function* (mention: Message) {
    let sessionId = "";
    yield* Effect.gen(function* () {
      const briefing = yield* buildBriefing(mention, bot);
      const metadata: Metadata = {
        guildId: mention.guild_id!,
        channelId: briefing.channel.id,
        ...(briefing.thread ? { threadId: briefing.thread.id } : {}),
        messageId: mention.id,
        bridgeUrl: settings.bridgeUrl,
        key: randomBytes(32).toString("hex"),
      };
      const session = yield* opencode.create({
        title: `#${briefing.thread?.name ?? briefing.channel.name} · ${mention.author.username}: ${mention.content.slice(0, 80)}`,
        metadata: { discord: metadata },
      });
      sessionId = session.id;
      tracked.set(sessionId, metadata);
      log.write("session.started", {
        sessionId,
        guildId: metadata.guildId,
        channelId: metadata.channelId,
        messageId: mention.id,
      });
      yield* opencode.prompt(sessionId, briefing.text);
    }).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          tracked.delete(sessionId);
          yield* typing.ended(sessionId);
          log.write("session.failed", {
            sessionId,
            guildId: mention.guild_id!,
            channelId: mention.channel_id,
            messageId: mention.id,
            error: error.message,
          });
        }),
      ),
    );
  });
});
