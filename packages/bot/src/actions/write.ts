import { Effect, Schema } from "effect";
import { ChannelType } from "discord-api-types/v10";
import { DiscordApi } from "../discord/api.ts";
import { Channel, Message } from "../discord/models.ts";
import { allowedMentions, splitText } from "../discord/text.ts";
import { BridgeError } from "../errors.ts";
import type { Action } from "./catalog.ts";
import { Typing } from "./typing.ts";

export const editOrDelete = Effect.fnUntraced(function* (
  action: Extract<Action, { name: "discord_edit_message" | "discord_delete_message" }>,
  botId: string,
) {
  const api = yield* DiscordApi;
  const { channel_id, message_id } = action.args;
  const message = yield* api.message(channel_id, message_id);
  if (message.author.id !== botId)
    return yield* new BridgeError({
      message: "You can only edit or delete your own messages",
      status: 403,
    });
  const path = `/channels/${channel_id}/messages/${message_id}` as const;
  if (action.name === "discord_delete_message") {
    yield* api.request("DELETE", path, Schema.Void);
    return `Deleted message ${message_id}`;
  }
  const { content } = action.args;
  if (!content || content.length > 2000)
    return yield* new BridgeError({
      message:
        "Edited content must have 1–2,000 characters; send additional messages for longer text",
      status: 400,
    });
  yield* api.request("PATCH", path, Message, {
    body: { content, allowed_mentions: allowedMentions(content, false) },
  });
  return `Edited message ${message_id}`;
});

export const createThread = Effect.fnUntraced(function* (
  args: Extract<Action, { name: "discord_create_thread" }>["args"],
) {
  const api = yield* DiscordApi;
  const typing = yield* Typing;
  const parent = yield* api.channel(args.channel_id);
  const forum = parent.type === ChannelType.GuildForum || parent.type === ChannelType.GuildMedia;
  if (forum && (!args.content || args.message_id))
    return yield* new BridgeError({
      message: "Forum posts require content and cannot start from a message",
      status: 400,
    });
  const path = args.message_id
    ? (`/channels/${parent.id}/messages/${args.message_id}/threads` as const)
    : (`/channels/${parent.id}/threads` as const);
  const opening = forum ? splitText(args.content!)[0]! : "";
  const thread = yield* api.request("POST", path, Channel, {
    body: {
      name: args.name,
      type: ChannelType.PublicThread,
      ...(forum
        ? {
            message: {
              content: opening,
              allowed_mentions: allowedMentions(opening, false),
            },
          }
        : {}),
    },
  });
  const remaining = forum ? args.content!.slice(opening.length) : args.content;
  if (remaining) {
    yield* api.send(thread.id, remaining, undefined, [], typing.posted(thread.id));
  }
  return `Created thread ${thread.id}`;
});
