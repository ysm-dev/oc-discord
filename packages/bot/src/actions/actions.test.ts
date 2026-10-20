import { expect, it } from "vitest";
import { mentioned } from "../../test/scenario.ts";
import { bot, channelId, guildId, message, threadId } from "../../test/discord.ts";

it("long replies preserve every character and allow only named-user and reply pings", async () => {
  const app = await mentioned();
  const content = `<@123> <@!123> <@456> @everyone @here <@&789>\n${"word ".repeat(1000)}`;
  const response = await app.action("discord_send_message", {
    channel_id: channelId,
    content,
    reply_to: message().id,
  });
  expect(response.status).toBe(200);
  const sent = [...app.discord.messages.values()].filter((item) => item.author.id === bot.id);
  expect(sent.map((item) => item.content).join("")).toBe(content);
  expect(sent.every((item) => item.content.length <= 2000)).toBe(true);
  const calls = app.discord.calls.filter(
    (call) => call.method === "POST" && call.path.endsWith("/messages"),
  );
  expect(calls[0]?.body).toMatchObject({
    allowed_mentions: { parse: [], users: ["123", "456"], replied_user: true },
  });
  expect(calls[1]?.body).toMatchObject({ allowed_mentions: { replied_user: false } });
});

it("the Agent can edit and delete its own messages and add and remove reactions", async () => {
  const app = await mentioned();
  await app.action("discord_send_message", { channel_id: channelId, content: "draft" });
  const id = [...app.discord.messages.keys()].at(-1)!;
  const args = { channel_id: channelId, message_id: id };
  expect((await app.action("discord_edit_message", { ...args, content: "corrected" })).status).toBe(
    200,
  );
  expect(app.discord.messages.get(id)?.content).toBe("corrected");
  for (const content of ["", "x".repeat(2001)])
    expect((await app.action("discord_edit_message", { ...args, content })).status).toBe(400);
  for (const action of ["discord_add_reaction", "discord_remove_reaction"]) {
    expect((await app.action(action, { ...args, emoji: "wave:123" })).status).toBe(200);
  }
  expect(app.discord.calls.some((call) => call.path.endsWith("/reactions/wave%3A123/@me"))).toBe(
    true,
  );
  expect((await app.action("discord_delete_message", args)).status).toBe(200);
  expect(app.discord.messages.has(id)).toBe(false);
  expect(
    (await app.action("discord_send_message", { channel_id: channelId, content: "" })).status,
  ).toBe(400);
});

it("threads are public, can start from a message, and forum posts require initial content", async () => {
  const app = await mentioned();
  for (const args of [{}, { message_id: message().id }, { content: "Thread opening" }]) {
    const result = await app.action("discord_create_thread", {
      channel_id: channelId,
      name: "Topic",
      ...args,
    });
    expect(await result.text()).toMatch(/Created thread \d+/);
  }
  app.discord.channels.set("700", { id: "700", guild_id: guildId, name: "forum", type: 15 });
  for (const args of [{}, { content: "hi", message_id: "123" }]) {
    expect(
      (await app.action("discord_create_thread", { channel_id: "700", name: "Topic", ...args }))
        .status,
    ).toBe(400);
  }
  expect(
    (
      await app.action("discord_create_thread", {
        channel_id: "700",
        name: "Topic",
        content: "forum post",
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await app.action("discord_create_thread", {
        channel_id: "700",
        name: "Long post",
        content: "x".repeat(3000),
      })
    ).status,
  ).toBe(200);
  expect(
    app.discord.calls
      .filter((call) => call.path.endsWith("/threads"))
      .every(
        (call) =>
          typeof call.body === "object" &&
          call.body !== null &&
          "type" in call.body &&
          call.body["type"] === 11,
      ),
  ).toBe(true);
});

it("the Agent can discover channels and members and page through history", async () => {
  const app = await mentioned();
  app.discord.messages.set(
    "400000000000000002",
    message({ id: "400000000000000002", content: "newer" }),
  );
  expect(await (await app.action("discord_list_channels", {})).text()).toContain(
    `discussion (id ${threadId}`,
  );
  expect(
    await (await app.action("discord_get_member", { user_id: "100000000000000002" })).text(),
  ).toContain("Ali (id");
  app.discord.member = { roles: [], joined_at: null };
  expect(
    await (await app.action("discord_get_member", { user_id: "100000000000000003" })).text(),
  ).toContain(
    "100000000000000003 (id 100000000000000003)\nUsername: unknown\nRoles: \nJoined: unknown",
  );
  for (const args of [
    {},
    { before: "500000000000000000", limit: 10 },
    { after: "1" },
    { around: "400000000000000000" },
  ]) {
    const text = await (
      await app.action("discord_read_messages", { channel_id: channelId, ...args })
    ).text();
    expect(text).toContain("Earlier conversation");
    expect(text.indexOf("newer")).toBeLessThan(text.indexOf("Earlier conversation"));
  }
  expect(
    (await app.action("discord_read_messages", { channel_id: channelId, before: "1", after: "2" }))
      .status,
  ).toBe(400);
});

it("search retries an unready index and converts dates to Discord snowflake bounds", async () => {
  const app = await mentioned();
  app.discord.searchIndexing = 1;
  app.discord.messages.set(
    "1560000000000000000",
    message({
      id: "1560000000000000000",
      author: { id: "123", username: "alice" },
      content: "Earlier conversation",
      attachments: [
        {
          filename: "diagram.png",
          content_type: "image/png",
          size: 68,
          url: "https://cdn.discord.test/diagram.png",
        },
      ],
    }),
  );
  const text = await (
    await app.action("discord_search_messages", {
      query: "earlier",
      author_id: "123",
      channel_id: channelId,
      has: "image",
      after: "2026-01-01",
      before: "2026-10-20T12:00:00Z",
      limit: 10,
    })
  ).text();
  expect(text).toContain("Earlier conversation");
  const calls = app.discord.calls.filter((call) => call.path.endsWith("/search"));
  expect(calls).toHaveLength(2);
  expect(calls[0]?.query.get("min_id")).toBe("1456074443980800000");
  expect(calls[0]?.query.get("max_id")).toBe("1562072894668800000");
  expect(calls[0]?.query.get("author_id")).toBe("123");
  expect(calls[0]?.query.get("channel_id")).toBe(channelId);
  expect(calls[0]?.query.get("has")).toBe("image");
  expect(calls[0]?.query.get("limit")).toBe("10");
  expect(calls[0]?.query.get("content")).toBe("earlier");
  expect((await app.action("discord_search_messages", {})).status).toBe(200);
  for (const after of ["2014-01-01", "2026-99-99"])
    expect((await app.action("discord_search_messages", { after })).status).toBe(400);
});
