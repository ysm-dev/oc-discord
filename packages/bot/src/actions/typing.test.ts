import { expect, it, onTestFinished, vi } from "vitest";
import { mentioned } from "../../test/scenario.ts";
import { channelId, message, threadId } from "../../test/discord.ts";

it("typing renews every eight seconds, survives another Session ending, and stops when a message is posted", async () => {
  const app = await mentioned();
  await app.mention(message({ id: "400000000000000002" }));
  await vi.waitFor(() => expect(app.opencode.prompts.size).toBe(2));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const typing = () => app.discord.calls.filter((call) => call.path.endsWith("/typing"));
  await Promise.all([
    app.action("discord_typing", { channel_id: channelId }),
    app.action("discord_typing", { channel_id: channelId }, "ses_2"),
  ]);
  expect(typing()).toHaveLength(1);
  app.opencode.finish("ses_1", "succeeded");
  await vi.advanceTimersByTimeAsync(8000);
  expect(typing()).toHaveLength(2);
  await app.action("discord_send_message", { channel_id: channelId, content: "Done" }, "ses_2");
  await vi.advanceTimersByTimeAsync(8000);
  expect(typing()).toHaveLength(2);
  await app.action("discord_typing", { channel_id: threadId }, "ses_2");
  app.opencode.finish("ses_2", "succeeded");
  await vi.advanceTimersByTimeAsync(8000);
  expect(typing()).toHaveLength(3);
});

it("typing renewal failures are logged without interrupting the Session", async () => {
  const app = await mentioned();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  await app.action("discord_typing", { channel_id: channelId });
  app.discord.failures.set(`/channels/${channelId}/typing`, 403);
  await vi.advanceTimersByTimeAsync(8000);
  expect(app.logs.join("\n")).toContain("typing.failed");
  expect(app.opencode.sessions.get("ses_1")?.outcome).toBeUndefined();
});
