import { Effect, Schema } from "effect";
import { timingSafeEqual } from "node:crypto";
import { ID } from "../discord/models.ts";
import { BridgeError } from "../errors.ts";
import { OpenCode } from "../opencode/client.ts";

export const Metadata = Schema.Struct({
  guildId: ID,
  channelId: ID,
  threadId: Schema.optionalKey(ID),
  messageId: ID,
  bridgeUrl: Schema.String,
  key: Schema.String,
});
export type Metadata = typeof Metadata.Type;

export const authorize = Effect.fnUntraced(function* (sessionId: string, key: string) {
  const opencode = yield* OpenCode;
  const visited = new Set<string>();
  let session = yield* opencode.get(sessionId);
  while (session.parentID) {
    if (visited.has(session.id))
      return yield* new BridgeError({ message: "Invalid Session ancestry", status: 403 });
    visited.add(session.id);
    session = yield* opencode.get(session.parentID);
  }
  const metadata = yield* Schema.decodeUnknownEffect(Metadata)(session.metadata?.["discord"]).pipe(
    Effect.mapError(
      () => new BridgeError({ message: "Session does not belong to this Bridge", status: 403 }),
    ),
  );
  const left = Buffer.from(key);
  const right = Buffer.from(metadata.key);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return yield* new BridgeError({ message: "Invalid Session key", status: 401 });
  }
  return { sessionId: session.id, metadata };
});
