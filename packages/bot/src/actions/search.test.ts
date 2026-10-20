import { expect, it, onTestFinished, vi } from "vitest";
import { mentioned } from "../../test/scenario.ts";
import { dateBound } from "../discord/date-bound.ts";

it.each([
  ["2015-01-01", "0"],
  ["2015-01-01T00:00:00.001Z", "4194304"],
  ["2026-01-01", "1456074443980800000"],
  ["2026-10-20T12:00:00Z", "1562072894668800000"],
])("search date %s converts to the exact Discord message-ID bound", (date, bound) => {
  expect(dateBound(date)).toBe(bound);
});

it("search defaults to Discord's 25-result page limit and rejects larger pages", async () => {
  const app = await mentioned();
  expect((await app.action("discord_search_messages", {})).status).toBe(200);
  const call = app.discord.calls.find((item) => item.path.endsWith("/search"));
  expect(call?.query.get("limit")).toBe("25");
  for (const limit of [0, 26, 100, 1.5]) {
    expect((await app.action("discord_search_messages", { limit })).status).toBe(400);
  }
});

it.each([
  [0.05, 50],
  [0, 100],
])(
  "search waits for Discord's suggested delay (%s seconds), using a short delay for zero",
  async (suggested, milliseconds) => {
    const app = await mentioned();
    app.discord.searchIndexing = 1;
    app.discord.searchRetryAfter = suggested;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const calls = () => app.discord.calls.filter((call) => call.path.endsWith("/search"));
    const pending = app.action("discord_search_messages", {});
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(calls()).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(milliseconds - 1);
      expect(calls()).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(calls()).toHaveLength(2);
    } finally {
      await vi.advanceTimersByTimeAsync(100);
      await pending;
    }
    expect(await (await pending).text()).toContain("Earlier conversation");
  },
);

it("three unready search responses end with an actionable error instead of retrying forever", async () => {
  const app = await mentioned();
  app.discord.searchIndexing = 10;
  app.discord.searchRetryAfter = 2;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  let response: Response | undefined;
  const pending = app.action("discord_search_messages", {}).then((value) => {
    response = value;
    return value;
  });
  try {
    await vi.advanceTimersByTimeAsync(4000);
    expect(app.discord.calls.filter((call) => call.path.endsWith("/search"))).toHaveLength(3);
    expect(response?.status).toBe(503);
    expect(await response?.text()).toBe(
      "Discord's search index is not ready after 3 attempts. Try again later or use discord_read_messages.",
    );
    await vi.advanceTimersByTimeAsync(2000);
    expect(app.discord.calls.filter((call) => call.path.endsWith("/search"))).toHaveLength(3);
  } finally {
    app.discord.searchIndexing = 0;
    await vi.advanceTimersByTimeAsync(2000);
    await pending;
  }
});
