import { DateTime, Effect } from "effect";
import { ChannelType } from "discord-api-types/v10";
import { DiscordApi } from "../discord/api.ts";
import { isThread, type Message, type User } from "../discord/models.ts";
import { Settings } from "../settings.ts";
import { renderBriefing } from "./render.ts";

export const buildBriefing = Effect.fnUntraced(function* (mention: Message, bot: User) {
  const api = yield* DiscordApi;
  const settings = yield* Settings;
  const target = yield* api.channel(mention.channel_id);
  const thread = isThread(target) ? target : undefined;
  const channel = thread?.parent_id ? yield* api.channel(thread.parent_id) : target;
  const data = yield* Effect.all(
    {
      guild: api.guild(mention.guild_id!),
      channels: api.channels(mention.guild_id!),
      roles: api.roles(mention.guild_id!),
      history: api.history(target.id, mention.id, settings.history),
    },
    { concurrency: "unbounded" },
  );
  const starter = thread
    ? yield* api
        .message(
          channel.type === ChannelType.GuildForum || channel.type === ChannelType.GuildMedia
            ? thread.id
            : channel.id,
          thread.id,
        )
        .pipe(
          Effect.catch((error) =>
            error.status === 404 ? Effect.succeed(undefined) : Effect.fail(error),
          ),
        )
    : undefined;
  const now = DateTime.formatIso(yield* DateTime.now);
  return {
    text: renderBriefing({
      ...data,
      channel,
      bot,
      now,
      mention,
      ...(thread ? { thread } : {}),
      ...(starter ? { starter } : {}),
    }),
    channel,
    thread,
  };
});
