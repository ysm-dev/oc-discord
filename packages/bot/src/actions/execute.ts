import { Effect, Schema } from "effect";
import { DiscordApi } from "../discord/api.ts";
import { BridgeError } from "../errors.ts";
import type { Metadata } from "../sessions/metadata.ts";
import type { Action } from "./catalog.ts";
import { getMember, listChannels, readMessages, search } from "./read.ts";
import { createThread, editOrDelete } from "./write.ts";
import { Typing } from "./typing.ts";

export const executeAction = Effect.fnUntraced(function* (
  action: Action,
  metadata: Metadata,
  sessionId: string,
  botId: string,
  files: { name: string; data: Uint8Array }[],
) {
  const api = yield* DiscordApi;
  const typing = yield* Typing;
  if ("channel_id" in action.args && action.args.channel_id) {
    const channel = yield* api.channel(action.args.channel_id);
    if (channel.guild_id !== metadata.guildId)
      return yield* new BridgeError({
        message: "Target channel is outside this Session's server",
        status: 403,
      });
  }
  switch (action.name) {
    case "discord_send_message": {
      const ids = yield* api.send(
        action.args.channel_id,
        action.args.content,
        action.args.reply_to,
        files,
        typing.posted(action.args.channel_id),
      );
      return `Sent messages: ${ids.join(", ")}`;
    }
    case "discord_edit_message":
    case "discord_delete_message":
      return yield* editOrDelete(action, botId);
    case "discord_add_reaction":
    case "discord_remove_reaction": {
      const { channel_id, message_id, emoji } = action.args;
      yield* api.request(
        action.name === "discord_add_reaction" ? "PUT" : "DELETE",
        `/channels/${channel_id}/messages/${message_id}/reactions/${encodeURIComponent(emoji)}/@me`,
        Schema.Void,
      );
      return `Updated your reaction on message ${message_id}`;
    }
    case "discord_create_thread":
      return yield* createThread(action.args);
    case "discord_list_channels":
      return yield* listChannels(metadata.guildId);
    case "discord_read_messages":
      return yield* readMessages(metadata.guildId, action.args);
    case "discord_search_messages":
      return yield* search(metadata.guildId, action.args);
    case "discord_get_member":
      return yield* getMember(metadata.guildId, action.args.user_id);
    default:
      yield* typing.start(sessionId, action.args.channel_id);
      return `Typing in channel ${action.args.channel_id}`;
  }
});
