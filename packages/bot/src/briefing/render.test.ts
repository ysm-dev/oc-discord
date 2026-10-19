import { expect, it } from "vitest";
import { renderBriefing, renderMessages } from "./render.ts";
import { alice, bot, channelId, guildId, message } from "../../test/discord.ts";

it("the transcript preserves identity, reply targets, attachments, embeds, reactions and readable mentions", () => {
  const item = message({
    member: { nick: "Ali" },
    content: "<@123> <@!124> <#1> <#2> <@&3> <@&4>",
    mentions: [{ id: "123", username: "joe" }],
    message_reference: { message_id: "reply" },
    attachments: [
      { filename: "photo.png", content_type: "image/png", size: 42, url: "https://cdn/photo" },
      { filename: "data", size: 1, url: "https://cdn/data" },
    ],
    embeds: [{ title: "Title", url: "https://example.com", description: "Description" }, {}],
    reactions: [
      { emoji: { name: "wave", id: "123" }, count: 2 },
      { emoji: { name: null, id: null }, count: 1 },
    ],
  });
  const text = renderMessages(
    [item],
    [{ id: "1", name: "general", type: 0 }],
    [{ id: "3", name: "Members" }],
  );
  expect(text).toContain("Ali (@alice");
  expect(text).toContain("reply to reply");
  expect(text).toContain(
    "@joe (id 123) @user (id 124) #general (id 1) #channel (id 2) @Members (id 3) @role (id 4)",
  );
  expect(text).toContain("photo.png (image/png, 42 bytes) https://cdn/photo");
  expect(text).toContain("data (unknown type, 1 bytes)");
  expect(text).toContain("Embed: Title | https://example.com | Description");
  expect(text).toContain("Reactions: wave:123 × 2, emoji × 1");
});

it("a plain channel Briefing works without nicknames, topic, reactions or replies", () => {
  const text = renderBriefing({
    guild: { id: guildId, name: "Server" },
    channel: { id: channelId, name: "general", type: 0 },
    bot,
    now: "2026-10-20T00:00:00Z",
    history: [],
    mention: message({ author: { ...alice, global_name: null }, reactions: [] }),
    channels: [],
    roles: [],
  });
  expect(text).toContain("alice (@alice");
  expect(text).toContain("Now: 2026-10-20T00:00:00Z");
  expect(text).not.toMatch(/Thread:|Reactions:|reply to/);
});
