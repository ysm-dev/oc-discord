import { Effect, Schema } from "effect";
import { DiscordApi } from "../discord/api.ts";
import { Message } from "../discord/models.ts";
import { visibleChannels } from "../discord/visibility.ts";
import { dateBound } from "../discord/date-bound.ts";
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

export const search = Effect.fnUntraced(function* (
  guildId: string,
  args: Extract<Action, { name: "discord_search_messages" }>["args"],
) {
  const api = yield* DiscordApi;
  const query = yield* Effect.try({
    try: () =>
      new URLSearchParams({
        limit: String(args.limit ?? 25),
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
  for (let attempt = 1; ; attempt++) {
    const result = yield* api.get(`/guilds/${guildId}/messages/search`, searchResult, query);
    if ("messages" in result) {
      const messages = [
        ...new Map(result.messages.flat().map((message) => [message.id, message])).values(),
      ];
      const text = yield* transcript(guildId, messages, true);
      return `Matches: ${result.total_results}\n${text}`;
    }
    if (attempt === 3)
      return yield* new BridgeError({
        message:
          "Discord's search index is not ready after 3 attempts. Try again later or use discord_read_messages.",
        status: 503,
      });
    yield* Effect.sleep(result.retry_after === 0 ? 100 : result.retry_after * 1000);
  }
});

const transcript = Effect.fnUntraced(function* (
  guildId: string,
  messages: readonly Message[],
  showChannel = false,
) {
  const api = yield* DiscordApi;
  const channels = yield* api.channels(guildId);
  const roles = yield* api.roles(guildId);
  return showChannel
    ? messages
        .map(
          (message) =>
            `Channel: ${message.channel_id}\n${renderMessages([message], channels, roles)}`,
        )
        .join("\n\n")
    : renderMessages(messages, channels, roles);
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
    messages.toSorted((a, b) => Number(BigInt(b.id) - BigInt(a.id))),
  );
});

export const listChannels = Effect.fnUntraced(function* (guildId: string, botId: string) {
  const api = yield* DiscordApi;
  const channels = yield* api.channels(guildId);
  const threads = yield* api.threads(guildId);
  const roles = yield* api.roles(guildId);
  const member = yield* api.member(guildId, botId);
  const visible = visibleChannels(channels, roles, member.roles, guildId, botId);
  const active = threads.threads.filter((thread) =>
    visible.some((channel) => channel.id === thread.parent_id),
  );
  return [...visible, ...active]
    .map(
      (channel) =>
        `${channel.name} (id ${channel.id}, type ${channel.type}${channel.parent_id ? `, parent ${channel.parent_id}` : ""})${channel.topic ? ` — ${channel.topic}` : ""}`,
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
