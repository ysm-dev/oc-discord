import { Effect, Schema } from "effect";
import { DiscordApi } from "../discord/api.ts";
import { Message } from "../discord/models.ts";
import { BridgeError } from "../errors.ts";
import { displayName, renderMessages } from "../briefing/render.ts";
import type { Action } from "./catalog.ts";

const searchResult = Schema.Union([
  Schema.Struct({ messages: Schema.Array(Schema.Array(Message)), total_results: Schema.Number }),
  Schema.Struct({
    code: Schema.Literal(110000),
    retry_after: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  }),
]);

function dateBound(date: string) {
  const milliseconds = Date.parse(date) - 1420070400000;
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new BridgeError({
      message: "Search dates must be valid ISO dates on or after 2015-01-01",
      status: 400,
    });
  }
  return (BigInt(milliseconds) << 22n).toString();
}

export const search = Effect.fnUntraced(function* (
  guildId: string,
  args: Extract<Action, { name: "discord_search_messages" }>["args"],
) {
  const api = yield* DiscordApi;
  const query = yield* Effect.try({
    try: () =>
      new URLSearchParams({
        limit: String(args.limit ?? 50),
        ...(args.query ? { content: args.query } : {}),
        ...(args.author_id ? { author_id: args.author_id } : {}),
        ...(args.channel_id ? { channel_id: args.channel_id } : {}),
        ...(args.has ? { has: args.has } : {}),
        ...(args.after ? { min_id: dateBound(args.after) } : {}),
        ...(args.before ? { max_id: dateBound(args.before) } : {}),
      }),
    catch: () =>
      new BridgeError({
        message: "Search dates must be valid ISO dates on or after 2015-01-01",
        status: 400,
      }),
  });
  while (true) {
    const result = yield* api.get(`/guilds/${guildId}/messages/search`, searchResult, query);
    if ("messages" in result) {
      const messages = [
        ...new Map(result.messages.flat().map((message) => [message.id, message])).values(),
      ];
      const text = yield* transcript(guildId, messages);
      return `Matches: ${result.total_results}\n${text}`;
    }
    yield* Effect.sleep(Math.max(100, result.retry_after * 1000));
  }
});

const transcript = Effect.fnUntraced(function* (guildId: string, messages: readonly Message[]) {
  const api = yield* DiscordApi;
  const channels = yield* api.channels(guildId);
  const roles = yield* api.roles(guildId);
  return renderMessages(messages, channels, roles);
});

export const readMessages = Effect.fnUntraced(function* (
  guildId: string,
  args: Extract<Action, { name: "discord_read_messages" }>["args"],
) {
  if ([args.before, args.after, args.around].filter(Boolean).length > 1) {
    return yield* new BridgeError({
      message: "Use only one of before, after or around",
      status: 400,
    });
  }
  const api = yield* DiscordApi;
  const query = new URLSearchParams({ limit: String(args.limit ?? 50) });
  for (const name of ["before", "after", "around"] as const)
    if (args[name]) query.set(name, args[name]);
  const messages = yield* api.messages(args.channel_id, query);
  return yield* transcript(
    guildId,
    messages.toSorted((a, b) => Number(BigInt(a.id) - BigInt(b.id))),
  );
});

export const listChannels = Effect.fnUntraced(function* (guildId: string) {
  const api = yield* DiscordApi;
  const channels = yield* api.channels(guildId);
  const threads = yield* api.threads(guildId);
  return [...channels, ...threads.threads]
    .map(
      (channel) =>
        `${channel.name} (id ${channel.id}, type ${channel.type}${channel.parent_id ? `, parent ${channel.parent_id}` : ""})`,
    )
    .join("\n");
});

export const getMember = Effect.fnUntraced(function* (guildId: string, userId: string) {
  const api = yield* DiscordApi;
  const member = yield* api.member(guildId, userId);
  const roles = yield* api.roles(guildId);
  return `${member.user ? displayName(member.user, member.nick) : userId} (id ${userId})\nUsername: ${member.user?.username ?? "unknown"}\nRoles: ${roles
    .filter((role) => member.roles.includes(role.id))
    .map((role) => `${role.name} (id ${role.id})`)
    .join(", ")}\nJoined: ${member.joined_at ?? "unknown"}`;
});
