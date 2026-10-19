import type { Channel, Message, User } from "../discord/models.ts";

export const displayName = (user: User, nick?: string | null) =>
  nick || user.global_name || user.username;

export function renderMessages(
  messages: readonly Message[],
  channels: readonly Channel[],
  roles: readonly { id: string; name: string }[],
): string {
  return messages
    .map((message) => {
      const names = new Map(message.mentions.map((user) => [user.id, displayName(user)]));
      const content = message.content
        .replace(/<@!?(\d+)>/g, (_, id: string) => `@${names.get(id) ?? "user"} (id ${id})`)
        .replace(
          /<#(\d+)>/g,
          (_, id: string) =>
            `#${channels.find((channel) => channel.id === id)?.name ?? "channel"} (id ${id})`,
        )
        .replace(
          /<@&(\d+)>/g,
          (_, id: string) => `@${roles.find((role) => role.id === id)?.name ?? "role"} (id ${id})`,
        );
      const reply = message.message_reference?.message_id;
      return [
        `[${message.timestamp}] ${displayName(message.author, message.member?.nick)} (@${message.author.username}, id ${message.author.id}), message ${message.id}${reply ? `, reply to ${reply}` : ""}`,
        content,
        ...message.attachments.map(
          (file) =>
            `Attachment: ${file.filename} (${file.content_type ?? "unknown type"}, ${file.size} bytes) ${file.url}`,
        ),
        ...message.embeds.map(
          (embed) =>
            `Embed: ${[embed.title, embed.url, embed.description].filter(Boolean).join(" | ")}`,
        ),
        ...(message.reactions?.length
          ? [
              `Reactions: ${message.reactions.map(({ emoji, count }) => `${emoji.name ?? "emoji"}${emoji.id ? `:${emoji.id}` : ""} × ${count}`).join(", ")}`,
            ]
          : []),
      ].join("\n");
    })
    .join("\n\n");
}

export function renderBriefing(input: {
  guild: { id: string; name: string };
  channel: Channel;
  thread?: Channel;
  bot: User;
  now: string;
  history: readonly Message[];
  mention: Message;
  starter?: Message;
  channels: readonly Channel[];
  roles: readonly { id: string; name: string }[];
}): string {
  const render = (messages: readonly Message[]) =>
    renderMessages(messages, input.channels, input.roles);
  return [
    `Server: ${input.guild.name} (id ${input.guild.id})`,
    `Channel: #${input.channel.name} (id ${input.channel.id})${input.channel.topic ? ` — ${input.channel.topic}` : ""}`,
    ...(input.thread ? [`Thread: ${input.thread.name} (id ${input.thread.id})`] : []),
    `You: ${displayName(input.bot)} (@${input.bot.username}, id ${input.bot.id})`,
    `Now: ${input.now}`,
    ...(input.starter ? [`\nThread starter:\n${render([input.starter])}`] : []),
    `\nRecent messages, oldest first:\n${render(input.history)}`,
    `\nMention:\n${render([input.mention])}`,
  ].join("\n");
}
