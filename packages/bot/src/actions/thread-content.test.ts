import { ChannelType } from "discord-api-types/v10";
import { expect, it } from "vitest";
import { bot, channelId, guildId } from "../../test/discord.ts";
import { mentioned } from "../../test/scenario.ts";

it.each([ChannelType.GuildForum, ChannelType.GuildMedia])(
  "a type %s opening post preserves complete Unicode characters across split messages",
  async (type) => {
    const app = await mentioned();
    app.discord.channels.set(channelId, { id: channelId, guild_id: guildId, name: "posts", type });
    const content = `${"x".repeat(1999)}😀tail`;
    const response = await app.action("discord_create_thread", {
      channel_id: channelId,
      name: "Unicode opening",
      content,
    });
    expect(response.status).toBe(200);
    const chunks = [...app.discord.messages.values()]
      .filter((item) => item.author.id === bot.id)
      .map((item) => item.content);
    expect(chunks).toEqual(["x".repeat(1999), "😀tail"]);
    expect(chunks.join("")).toBe(content);
  },
);
