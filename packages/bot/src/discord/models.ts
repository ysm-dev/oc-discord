import { Schema } from "effect";
import { ChannelType } from "discord-api-types/v10";

export const ID = Schema.String.check(Schema.isPattern(/^\d+$/));
export const User = Schema.Struct({
  id: ID,
  username: Schema.String,
  global_name: Schema.optional(Schema.NullOr(Schema.String)),
  bot: Schema.optional(Schema.Boolean),
});
export const Member = Schema.Struct({
  user: Schema.optional(User),
  nick: Schema.optional(Schema.NullOr(Schema.String)),
  roles: Schema.Array(ID),
  joined_at: Schema.NullOr(Schema.String),
});
export const Channel = Schema.Struct({
  id: ID,
  type: Schema.Enum(ChannelType),
  name: Schema.optional(Schema.String),
  guild_id: Schema.optional(ID),
  parent_id: Schema.optional(Schema.NullOr(ID)),
  topic: Schema.optional(Schema.NullOr(Schema.String)),
  permission_overwrites: Schema.optional(
    Schema.Array(Schema.Struct({ id: ID, type: Schema.Literals([0, 1]), allow: ID, deny: ID })),
  ),
});
export const Message = Schema.Struct({
  id: ID,
  channel_id: ID,
  guild_id: Schema.optional(ID),
  author: User,
  member: Schema.optional(Schema.Struct({ nick: Schema.optional(Schema.NullOr(Schema.String)) })),
  content: Schema.String,
  timestamp: Schema.String,
  mentions: Schema.Array(User),
  mention_roles: Schema.optional(Schema.Array(ID)),
  message_reference: Schema.optional(Schema.Struct({ message_id: Schema.optional(ID) })),
  attachments: Schema.Array(
    Schema.Struct({
      filename: Schema.String,
      content_type: Schema.optional(Schema.String),
      size: Schema.Number,
      url: Schema.String,
    }),
  ),
  embeds: Schema.Array(
    Schema.Struct({
      title: Schema.optional(Schema.String),
      url: Schema.optional(Schema.String),
      description: Schema.optional(Schema.String),
    }),
  ),
  reactions: Schema.optional(
    Schema.Array(
      Schema.Struct({
        emoji: Schema.Struct({ name: Schema.NullOr(Schema.String), id: Schema.NullOr(ID) }),
        count: Schema.Number,
      }),
    ),
  ),
});
export type Message = typeof Message.Type;
export type Channel = typeof Channel.Type;
export type User = typeof User.Type;
export const Guild = Schema.Struct({ id: ID, name: Schema.String });
export const Application = Schema.Struct({ id: ID, verify_key: Schema.String });
export const Threads = Schema.Struct({ threads: Schema.Array(Channel) });
export const Roles = Schema.Array(Schema.Struct({ id: ID, name: Schema.String, permissions: ID }));

export const isThread = (channel: Channel) =>
  [ChannelType.AnnouncementThread, ChannelType.PublicThread, ChannelType.PrivateThread].some(
    (type) => type === channel.type,
  );

export function isMention(type: string, message: Message, botId: string): boolean {
  return (
    type === "GATEWAY_MESSAGE_CREATE" &&
    !!message.guild_id &&
    !message.author.bot &&
    message.mentions.some((user) => user.id === botId)
  );
}
