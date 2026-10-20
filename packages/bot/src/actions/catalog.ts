import { Schema } from "effect";
import { ID } from "../discord/models.ts";

const channel_id = ID.annotate({ description: "Channel or thread ID in this server" });
const message_id = ID.annotate({ description: "Message ID" });
const content = Schema.String.annotate({
  description: "Message text; use <@user_id> to name a person",
});
const emoji = Schema.NonEmptyString.annotate({
  description: "Unicode emoji or name:id for a server emoji",
});
const limit = Schema.optional(
  Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })).annotate({
    description: "Maximum messages, 1–100; default 50",
  }),
);
const before = Schema.optional(ID.annotate({ description: "Messages before this message ID" }));
const after = Schema.optional(ID.annotate({ description: "Messages after this message ID" }));
const date = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}(?:T.*Z)?$/));

function action<const N extends string, F extends Schema.Struct.Fields>(
  name: N,
  description: string,
  fields: F,
) {
  const input = Schema.Struct(fields);
  return {
    name,
    description,
    input,
    call: Schema.Struct({ name: Schema.Literal(name), args: input }),
  };
}

export const catalog = [
  action(
    "discord_send_message",
    "Send a message or reply. Long text is split; returns message IDs.",
    {
      channel_id,
      content,
      reply_to: Schema.optional(message_id),
      files: Schema.optional(
        Schema.Array(Schema.String).check(Schema.isMaxLength(10)).annotate({
          description:
            "Paths of files inside the Session directory, at most 10, each at most 20 MiB",
        }),
      ),
    },
  ),
  action("discord_edit_message", "Edit one of your messages (at most 2,000 characters).", {
    channel_id,
    message_id,
    content,
  }),
  action("discord_delete_message", "Delete one of your messages.", { channel_id, message_id }),
  action("discord_add_reaction", "Add your reaction to a message.", {
    channel_id,
    message_id,
    emoji,
  }),
  action("discord_remove_reaction", "Remove your reaction from a message.", {
    channel_id,
    message_id,
    emoji,
  }),
  action("discord_create_thread", "Start a public thread or a forum post; returns its ID.", {
    channel_id,
    name: Schema.NonEmptyString.check(Schema.isMaxLength(100)).annotate({
      description: "Thread or forum post title",
    }),
    message_id: Schema.optional(message_id),
    content: Schema.optional(
      content.annotate({ description: "First message; required for a forum post" }),
    ),
  }),
  action("discord_list_channels", "List this server's channels and active threads.", {}),
  action("discord_read_messages", "Read channel or thread history in transcript format.", {
    channel_id,
    before,
    after,
    around: Schema.optional(
      message_id.annotate({
        description: "Read messages around this ID; use only one paging parameter",
      }),
    ),
    limit,
  }),
  action(
    "discord_search_messages",
    "Search this server's history; returns matching messages and IDs.",
    {
      query: Schema.optional(Schema.String.annotate({ description: "Text to find" })),
      author_id: Schema.optional(ID.annotate({ description: "Filter by author ID" })),
      channel_id: Schema.optional(channel_id),
      has: Schema.optional(
        Schema.Literals(["image", "file", "link", "embed", "video", "sound", "sticker"]).annotate({
          description: "Attachment or content type",
        }),
      ),
      after: Schema.optional(date.annotate({ description: "After this UTC date (ISO 8601)" })),
      before: Schema.optional(date.annotate({ description: "Before this UTC date (ISO 8601)" })),
      limit,
    },
  ),
  action("discord_get_member", "Look up a server member's display name, roles and join date.", {
    user_id: ID.annotate({ description: "Member's user ID" }),
  }),
  action("discord_typing", "Show typing until you post in this channel or the Session ends.", {
    channel_id,
  }),
] as const;

export const Action = Schema.Union(catalog.map((entry) => entry.call));
export type Action = typeof Action.Type;
