import { ChannelType } from "discord-api-types/v10";
import { expect, it, vi } from "vitest";
import { FakeDiscord, channelId, guildId, message, threadId } from "../../test/discord.ts";
import { scenario } from "../../test/scenario.ts";

it.each([
  [ChannelType.GuildForum, 0],
  [ChannelType.GuildForum, 1],
  [ChannelType.GuildMedia, 0],
  [ChannelType.GuildMedia, 1],
])("a type %s thread includes its opening post even outside history %s", async (type, history) => {
  const discord = new FakeDiscord();
  discord.channels.set(channelId, { id: channelId, guild_id: guildId, name: "posts", type });
  discord.messages.set(
    threadId,
    message({ id: threadId, channel_id: threadId, content: "The original topic" }),
  );
  discord.messages.set(
    "400000000000000000",
    message({ id: "400000000000000000", channel_id: threadId, content: "Recent discussion" }),
  );
  // Discord has no messages in forum/media parents; the opening post lives in the thread.
  discord.failures.set(`/channels/${channelId}/messages/${threadId}`, 404);
  const app = await scenario(discord, undefined, { history });
  await app.mention(message({ channel_id: threadId }));
  await vi.waitFor(() => expect(app.opencode.prompts.size).toBe(1));
  const briefing = app.opencode.prompts.get("ses_1")!;
  expect(briefing).toContain("The original topic");
  expect(briefing.includes("Recent discussion")).toBe(history > 0);
  expect(briefing.indexOf("The original topic")).toBeLessThan(
    briefing.indexOf(history ? "Recent discussion" : "Mention:"),
  );
});
