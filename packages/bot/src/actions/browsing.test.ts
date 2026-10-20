import { expect, it, vi } from "vitest";
import { mentioned } from "../../test/scenario.ts";
import { bot, channelId, guildId, message, threadId } from "../../test/discord.ts";

async function browsing() {
  const app = await mentioned();
  await app.opencode.loadPlugin();
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) =>
    app.handler(new Request(input, init)),
  );
  return app;
}

it("the Agent discovers channel topics, categories and active threads through the installed plugin", async () => {
  const app = await browsing();
  const categoryId = "300000000000000003";
  app.discord.channels.set(categoryId, {
    id: categoryId,
    guild_id: guildId,
    name: "Community",
    type: 4,
  });
  app.discord.channels.set(channelId, {
    ...app.discord.channels.get(channelId)!,
    parent_id: categoryId,
  });
  const { content } = await app.opencode.call("discord_list_channels", {});
  expect(content).toContain(`general (id ${channelId}, type 0, parent ${categoryId}) — Welcome`);
  expect(content).toContain(`Community (id ${categoryId}, type 4)`);
  expect(content).toContain(`discussion (id ${threadId}, type 11, parent ${channelId})`);
});

it("channel visibility respects role allows, member overrides and administrator access", async () => {
  const app = await browsing();
  const roleId = "600000000000000002";
  const unrelatedRoleId = "600000000000000003";
  app.discord.roles.push(
    { id: roleId, name: "Readers", permissions: "0" },
    { id: unrelatedRoleId, name: "Administrators", permissions: "8" },
  );
  app.discord.member = { ...app.discord.member, roles: ["600000000000000001", roleId] };
  const overwrites = [
    { id: guildId, type: 0, allow: "0", deny: "1024" },
    { id: "600000000000000001", type: 0, allow: "0", deny: "1024" },
    { id: roleId, type: 0, allow: "1024", deny: "0" },
    { id: unrelatedRoleId, type: 0, allow: "0", deny: "1024" },
    { id: "100000000000000099", type: 1, allow: "0", deny: "1024" },
  ] as const;
  const channel = app.discord.channels.get(channelId)!;
  app.discord.channels.set(channelId, { ...channel, permission_overwrites: overwrites });
  expect((await app.opencode.call("discord_list_channels", {})).content).toContain("general");
  app.discord.channels.set(channelId, {
    ...channel,
    permission_overwrites: [...overwrites, { id: bot.id, type: 1, allow: "0", deny: "1024" }],
  });
  const hidden = (await app.opencode.call("discord_list_channels", {})).content;
  expect(hidden).not.toContain("general");
  expect(hidden).not.toContain("discussion");
  app.discord.roles[1]!.permissions = "8";
  expect((await app.opencode.call("discord_list_channels", {})).content).toContain("general");
});

it("browsing and searching stay in the Session's Guild and reject foreign targets", async () => {
  const app = await browsing();
  const foreignChannel = "300000000000000099";
  const foreignMember = "100000000000000099";
  app.discord.channels.set(foreignChannel, {
    id: foreignChannel,
    guild_id: "200000000000000099",
    name: "Other server",
    type: 0,
  });
  app.discord.messages.set(
    "400000000000000099",
    message({
      id: "400000000000000099",
      channel_id: foreignChannel,
      guild_id: "200000000000000099",
      content: "Other server's conversation",
    }),
  );
  for (const name of ["discord_read_messages", "discord_search_messages"]) {
    expect((await app.action(name, { channel_id: foreignChannel })).status).toBe(403);
    const args = name === "discord_read_messages" ? { channel_id: channelId } : {};
    expect((await app.opencode.call(name, args)).content).not.toContain("Other server");
  }
  expect((await app.opencode.call("discord_list_channels", {})).content).not.toContain(
    "Other server",
  );
  app.discord.failures.set(`/guilds/${guildId}/members/${foreignMember}`, 404);
  expect((await app.action("discord_get_member", { user_id: foreignMember })).status).toBe(404);
  expect(
    app.discord.calls
      .filter((call) => call.path.startsWith("/guilds/"))
      .every((call) => call.path.split("/")[2] === guildId),
  ).toBe(true);
});

it("the installed member Action returns the member's display name, username, roles and join date", async () => {
  const app = await browsing();
  expect(
    (await app.opencode.call("discord_get_member", { user_id: "100000000000000002" })).content,
  ).toBe(
    "Ali (id 100000000000000002)\nUsername: alice\nRoles: Members (id 600000000000000001)\nJoined: 2026-01-01T00:00:00Z",
  );
});

it("channel discovery includes a denied category when one of its children is visible", async () => {
  const app = await browsing();
  const categoryId = "300000000000000003";
  app.discord.channels.set(categoryId, {
    id: categoryId,
    guild_id: guildId,
    name: "Community",
    type: 4,
    permission_overwrites: [{ id: guildId, type: 0, allow: "0", deny: "1024" }],
  });
  app.discord.channels.set(channelId, {
    ...app.discord.channels.get(channelId)!,
    parent_id: categoryId,
  });
  expect((await app.opencode.call("discord_list_channels", {})).content).toContain("Community");
});

it("channel discovery excludes channels hidden from the Bot by member permissions", async () => {
  const app = await browsing();
  app.discord.channels.set("300000000000000099", {
    id: "300000000000000099",
    guild_id: guildId,
    name: "Hidden plans",
    topic: "Private topic",
    type: 0,
    permission_overwrites: [{ id: bot.id, type: 1, allow: "0", deny: "1024" }],
  });
  const { content } = await app.opencode.call("discord_list_channels", {});
  expect(content).toContain("general");
  expect(content).not.toContain("Hidden plans");
  expect(content).not.toContain("Private topic");
});

it("search hits identify their channels and retain the Briefing message layout", async () => {
  const app = await browsing();
  app.discord.messages.set(
    "400000000000000010",
    message({ id: "400000000000000010", channel_id: threadId, content: "Thread match" }),
  );
  const { content } = await app.opencode.call("discord_search_messages", {});
  expect(content).toContain(
    `Channel: ${channelId}\n[2026-10-20T12:00:00.000Z] Alice (@alice, id 100000000000000002), message 400000000000000000\nEarlier conversation`,
  );
  expect(content).toContain(
    `Channel: ${threadId}\n[2026-10-20T12:00:00.000Z] Alice (@alice, id 100000000000000002), message 400000000000000010\nThread match`,
  );
});

it("the Agent reads newest-first transcript pages before, after and around a message in a thread", async () => {
  const app = await browsing();
  for (let index = 10; index <= 14; index++) {
    const item = message({
      id: `4000000000000000${index}`,
      channel_id: threadId,
      content: `Thread message ${index}`,
    });
    app.discord.messages.set(item.id, item);
  }
  for (const [paging, ids] of [
    [{}, [14, 13, 12]],
    [{ before: "400000000000000012" }, [11, 10]],
    [{ after: "400000000000000012" }, [14, 13]],
    [{ around: "400000000000000012" }, [13, 12, 11]],
  ] as const) {
    const { content } = await app.opencode.call("discord_read_messages", {
      channel_id: threadId,
      limit: 3,
      ...paging,
    });
    expect(content.match(/Thread message \d+/g)).toEqual(ids.map((id) => `Thread message ${id}`));
    expect(content).toContain(
      "[2026-10-20T12:00:00.000Z] Alice (@alice, id 100000000000000002), message 4000000000000000",
    );
    const request = app.discord.calls.findLast(
      (call) => call.path === `/channels/${threadId}/messages`,
    );
    expect(Object.fromEntries(request!.query)).toEqual({ limit: "3", ...paging });
  }
});

it("read pages default to 50 messages and accept only limits from 1 through 100", async () => {
  const app = await browsing();
  for (const args of [{}, { limit: 1 }, { limit: 100 }]) {
    expect(
      (await app.action("discord_read_messages", { channel_id: channelId, ...args })).status,
    ).toBe(200);
    const request = app.discord.calls.findLast(
      (call) => call.path === `/channels/${channelId}/messages`,
    );
    expect(request?.query.get("limit")).toBe(String(args.limit ?? 50));
  }
  for (const limit of [0, 101, 1.5]) {
    expect(
      (await app.action("discord_read_messages", { channel_id: channelId, limit })).status,
    ).toBe(400);
  }
});
