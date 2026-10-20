import { expect, it, onTestFinished, vi } from "vitest";
import { bot, channelId, FakeDiscord } from "../../test/discord.ts";
import { mentioned } from "../../test/scenario.ts";

it.each([0, 1])(
  "typing after a split send fails with %s messages posted reflects whether a reply appeared",
  async (posted) => {
    const discord = new FakeDiscord();
    const request = discord.request;
    let attempts = 0;
    vi.spyOn(discord, "request").mockImplementation((url, init) => {
      const path = `/channels/${channelId}/messages`;
      if (init.method === "POST" && new URL(url).pathname.endsWith(path)) {
        if (attempts++ === posted) discord.failures.set(path, 403);
      }
      return request(url, init);
    });
    const app = await mentioned(discord);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    onTestFinished(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });
    await app.action("discord_typing", { channel_id: channelId });
    const response = await app.action("discord_send_message", {
      channel_id: channelId,
      content: "x".repeat(3000),
    });
    expect(response.status).toBe(403);
    expect([...discord.messages.values()].filter((item) => item.author.id === bot.id)).toHaveLength(
      posted,
    );
    await vi.advanceTimersByTimeAsync(8000);
    expect(discord.calls.filter((call) => call.path.endsWith("/typing"))).toHaveLength(
      posted ? 1 : 2,
    );
  },
);
