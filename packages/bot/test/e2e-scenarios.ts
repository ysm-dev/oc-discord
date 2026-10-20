import { strict as assert } from "node:assert";
import { Schema } from "effect";
import { FakeDiscord, channelId, guildId, threadId, alice, bot, message } from "./discord.ts";
import type { Step } from "./e2e-model.ts";

const historyId = "400000000000000000";
const ownId = "400000000000000002";
const historyText = `[2026-10-20T12:00:00.000Z] Alice (@alice, id ${alice.id}), message ${historyId}\nEarlier conversation`;
export const artifact = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);

function request(discord: FakeDiscord, method: string, path: string) {
  const call = discord.calls.findLast((item) => item.method === method && item.path === path);
  assert(call, `Missing Discord HTTP request: ${method} ${path}`);
  return call;
}

function scenario(name: string, steps: (discord: FakeDiscord) => Step[]) {
  const discord = new FakeDiscord();
  return { name, discord, steps: steps(discord) };
}

function typing(discord: FakeDiscord): Step {
  return {
    action: { name: "discord_typing", args: { channel_id: channelId } },
    check(result) {
      assert.equal(result, `Typing in channel ${channelId}`);
      request(discord, "POST", `/channels/${channelId}/typing`);
    },
  };
}

function uploadedReply(discord: FakeDiscord): Step {
  return {
    action: {
      name: "discord_send_message",
      args: {
        channel_id: channelId,
        content: "Real OpenCode reply",
        reply_to: historyId,
        files: ["artifact.png"],
      },
    },
    async check(result) {
      const sent = [...discord.messages.values()].filter((item) => item.author.id === bot.id);
      assert.equal(sent.length, 1);
      assert.equal(sent[0]!.content, "Real OpenCode reply");
      assert.equal(result, `Sent messages: ${sent[0]!.id}`);
      const call = request(discord, "POST", `/channels/${channelId}/messages`);
      const body = Schema.decodeUnknownSync(Schema.JsonObject)(call.body);
      assert.deepEqual(body["message_reference"], { message_id: historyId });
      assert.equal(call.files.length, 1);
      assert.equal(call.files[0]!.name, "artifact.png");
      assert.deepEqual(Buffer.from(await call.files[0]!.arrayBuffer()), artifact);
    },
  };
}

function threadReply(discord: FakeDiscord) {
  const args = { channel_id: "", content: "Follow-up using the returned thread ID" };
  const step: Step = {
    action: { name: "discord_send_message", args },
    check(result) {
      const sent = [...discord.messages.values()].find(
        (item) => item.channel_id === args.channel_id && item.content === args.content,
      );
      assert(sent);
      assert.equal(result, `Sent messages: ${sent.id}`);
      request(discord, "POST", `/channels/${args.channel_id}/messages`);
    },
  };
  return { args, step };
}

export function scenarios() {
  return [
    scenario("Mention → Briefing → typing → reply with uploaded Session file", (discord) => [
      typing(discord),
      uploadedReply(discord),
    ]),
    scenario("show typing without posting", (discord) => [typing(discord)]),
    scenario("reject a missing Session file without sending", (discord) => [
      {
        action: {
          name: "discord_send_message",
          args: { channel_id: channelId, content: "Missing file", files: ["missing.png"] },
        },
        check(result) {
          assert.match(result, /ENOENT|no such file/i);
          assert.match(result, /missing\.png/);
          assert(discord.calls.every((call) => call.method === "GET"));
        },
      },
    ]),
    scenario("send a long message with safe pings", (discord) => {
      const content = `${"Hello ".repeat(400)}<@${alice.id}> @everyone <@&600000000000000001>`;
      return [
        {
          action: { name: "discord_send_message", args: { channel_id: threadId, content } },
          check(result) {
            const sent = [...discord.messages.values()].filter(
              (item) => item.channel_id === threadId,
            );
            assert.equal(sent.length, 2);
            assert(sent.every((item) => item.content.length <= 2000));
            assert.equal(sent.map((item) => item.content).join(""), content);
            assert.equal(result, `Sent messages: ${sent.map((item) => item.id).join(", ")}`);
            const calls = discord.calls.filter(
              (item) => item.method === "POST" && item.path === `/channels/${threadId}/messages`,
            );
            assert.equal(calls.length, 2);
            for (const call of calls) {
              const body = Schema.decodeUnknownSync(Schema.JsonObject)(call.body);
              const mentions = Schema.decodeUnknownSync(Schema.JsonObject)(
                body["allowed_mentions"],
              );
              assert.deepEqual(mentions["parse"], []);
              assert.equal(mentions["roles"], undefined);
              assert.equal(mentions["replied_user"], false);
            }
            const last = Schema.decodeUnknownSync(Schema.JsonObject)(calls[1]!.body);
            const mentions = Schema.decodeUnknownSync(Schema.JsonObject)(last["allowed_mentions"]);
            assert.deepEqual(mentions["users"], [alice.id]);
          },
        },
      ];
    }),
    scenario("edit the Bot's message", (discord) => {
      discord.messages.set(ownId, message({ id: ownId, author: bot, content: "Original" }));
      return [
        {
          action: {
            name: "discord_edit_message",
            args: { channel_id: channelId, message_id: ownId, content: "Corrected" },
          },
          check(result) {
            assert.equal(result, `Edited message ${ownId}`);
            assert.equal(discord.messages.get(ownId)?.content, "Corrected");
            request(discord, "PATCH", `/channels/${channelId}/messages/${ownId}`);
          },
        },
      ];
    }),
    scenario("delete the Bot's message", (discord) => {
      discord.messages.set(ownId, message({ id: ownId, author: bot, content: "Remove me" }));
      return [
        {
          action: {
            name: "discord_delete_message",
            args: { channel_id: channelId, message_id: ownId },
          },
          check(result) {
            assert.equal(result, `Deleted message ${ownId}`);
            assert(!discord.messages.has(ownId));
            request(discord, "DELETE", `/channels/${channelId}/messages/${ownId}`);
          },
        },
      ];
    }),
    scenario("add a Unicode reaction", (discord) => [
      {
        action: {
          name: "discord_add_reaction",
          args: { channel_id: channelId, message_id: historyId, emoji: "👍" },
        },
        check(result) {
          assert.equal(result, `Updated your reaction on message ${historyId}`);
          request(
            discord,
            "PUT",
            `/channels/${channelId}/messages/${historyId}/reactions/%F0%9F%91%8D/@me`,
          );
          assert(discord.reactions.has(`${historyId}:👍`));
        },
      },
    ]),
    scenario("remove the Bot's server-emoji reaction", (discord) => {
      const reaction = `${historyId}:wave:600000000000000002`;
      discord.reactions.add(reaction);
      return [
        {
          action: {
            name: "discord_remove_reaction",
            args: {
              channel_id: channelId,
              message_id: historyId,
              emoji: "wave:600000000000000002",
            },
          },
          check(result) {
            assert.equal(result, `Updated your reaction on message ${historyId}`);
            request(
              discord,
              "DELETE",
              `/channels/${channelId}/messages/${historyId}/reactions/wave%3A600000000000000002/@me`,
            );
            assert(!discord.reactions.has(reaction));
          },
        },
      ];
    }),
    scenario("list channels and active threads", (discord) => [
      {
        action: { name: "discord_list_channels", args: {} },
        check(result) {
          assert.match(result, new RegExp(`general \\(id ${channelId}, type 0\\)`));
          assert.match(
            result,
            new RegExp(`discussion \\(id ${threadId}, type 11, parent ${channelId}\\)`),
          );
          request(discord, "GET", `/guilds/${guildId}/channels`);
          request(discord, "GET", `/guilds/${guildId}/threads/active`);
        },
      },
    ]),
    scenario("read messages page by page in Briefing layout", (discord) => {
      discord.messages.set(ownId, message({ id: ownId, content: "Newer history", mentions: [] }));
      return [
        {
          action: {
            name: "discord_read_messages",
            args: { channel_id: channelId, before: ownId, limit: 1 },
          },
          check(result) {
            assert.equal(result, historyText);
            const call = request(discord, "GET", `/channels/${channelId}/messages`);
            assert.equal(call.query.get("before"), ownId);
            assert.equal(call.query.get("limit"), "1");
          },
        },
        {
          action: {
            name: "discord_read_messages",
            args: { channel_id: channelId, after: historyId, limit: 1 },
          },
          check(result) {
            assert.equal(
              result,
              `[2026-10-20T12:00:00.000Z] Alice (@alice, id ${alice.id}), message ${ownId}\nNewer history`,
            );
            const call = request(discord, "GET", `/channels/${channelId}/messages`);
            assert.equal(call.query.get("after"), historyId);
            assert.equal(call.query.get("limit"), "1");
          },
        },
        {
          action: {
            name: "discord_read_messages",
            args: { channel_id: channelId, around: historyId, limit: 1 },
          },
          check(result) {
            assert.equal(result, historyText);
            const call = request(discord, "GET", `/channels/${channelId}/messages`);
            assert.equal(call.query.get("around"), historyId);
            assert.equal(call.query.get("limit"), "1");
          },
        },
      ];
    }),
    scenario("search with filters and retry while Discord indexes", (discord) => {
      discord.searchIndexing = 1;
      const match = message({
        id: "1560000000000000001",
        content: "Earlier conversation",
        mentions: [],
        attachments: [
          {
            filename: "notes.txt",
            content_type: "text/plain",
            size: 5,
            url: "https://cdn.discord.test/notes.txt",
          },
        ],
      });
      for (const overrides of [
        {},
        { id: "1560000000000000000" },
        { id: "1560000000000000002", author: bot },
        { id: "1560000000000000003", channel_id: threadId },
        { id: "1560000000000000004", attachments: [] },
        { id: "1560000000000000005", content: "Unrelated discussion" },
        { id: "1400000000000000000" },
        { id: "1600000000000000000" },
      ]) {
        const item = { ...match, ...overrides };
        discord.messages.set(item.id, item);
      }
      return [
        {
          action: {
            name: "discord_search_messages",
            args: {
              query: "Earlier",
              author_id: alice.id,
              channel_id: channelId,
              has: "file",
              after: "2026-01-01",
              before: "2027-01-01",
              limit: 1,
            },
          },
          check(result) {
            assert.equal(
              result,
              `Matches: 2\n[2026-10-20T12:00:00.000Z] Alice (@alice, id ${alice.id}), message 1560000000000000001\nEarlier conversation\nAttachment: notes.txt (text/plain, 5 bytes) https://cdn.discord.test/notes.txt`,
            );
            const calls = discord.calls.filter(
              (call) => call.path === `/guilds/${guildId}/messages/search`,
            );
            assert.equal(calls.length, 2);
            for (const call of calls)
              assert.deepEqual(Object.fromEntries(call.query), {
                limit: "1",
                content: "Earlier",
                author_id: alice.id,
                channel_id: channelId,
                has: "file",
                min_id: "1456074443980800000",
                max_id: "1588346014924800000",
              });
          },
        },
      ];
    }),
    scenario("look up a member's name, roles and join date", (discord) => [
      {
        action: { name: "discord_get_member", args: { user_id: alice.id } },
        check(result) {
          assert.equal(
            result,
            `Ali (id ${alice.id})\nUsername: alice\nRoles: Members (id 600000000000000001)\nJoined: 2026-01-01T00:00:00Z`,
          );
          request(discord, "GET", `/guilds/${guildId}/members/${alice.id}`);
          request(discord, "GET", `/guilds/${guildId}/roles`);
        },
      },
    ]),
    ...[false, true].map((fromMessage) =>
      scenario(
        fromMessage ? "start a thread from a message" : "start a public standalone thread",
        (discord) => {
          const reply = threadReply(discord);
          return [
            {
              action: {
                name: "discord_create_thread",
                args: {
                  channel_id: channelId,
                  name: "A longer discussion",
                  content: "Thread starter",
                  ...(fromMessage ? { message_id: historyId } : {}),
                },
              },
              check(result) {
                const thread = [...discord.channels.values()].find(
                  (item) => item.name === "A longer discussion",
                );
                assert(thread);
                assert.equal(thread.parent_id, channelId);
                assert.equal(thread.type, 11);
                assert.equal(result, `Created thread ${thread.id}`);
                if (fromMessage) assert.equal(thread.id, historyId);
                reply.args.channel_id = result.replace("Created thread ", "");
                const path = fromMessage
                  ? `/channels/${channelId}/messages/${historyId}/threads`
                  : `/channels/${channelId}/threads`;
                const call = request(discord, "POST", path);
                const body = Schema.decodeUnknownSync(Schema.JsonObject)(call.body);
                assert.equal(body["type"], 11);
                assert(
                  [...discord.messages.values()].some(
                    (item) => item.channel_id === thread.id && item.content === "Thread starter",
                  ),
                );
              },
            },
            reply.step,
          ];
        },
      ),
    ),
    scenario("start a forum post with its first message", (discord) => {
      const forumId = "300000000000000003";
      discord.channels.set(forumId, { id: forumId, guild_id: guildId, name: "forum", type: 15 });
      const reply = threadReply(discord);
      return [
        {
          action: {
            name: "discord_create_thread",
            args: { channel_id: forumId, name: "Forum topic", content: "Forum opener" },
          },
          check(result) {
            const thread = [...discord.channels.values()].find(
              (item) => item.name === "Forum topic",
            );
            assert(thread);
            assert.equal(result, `Created thread ${thread.id}`);
            reply.args.channel_id = result.replace("Created thread ", "");
            assert.equal(thread.parent_id, forumId);
            assert(
              [...discord.messages.values()].some(
                (item) => item.channel_id === thread.id && item.content === "Forum opener",
              ),
            );
            const call = request(discord, "POST", `/channels/${forumId}/threads`);
            const body = Schema.decodeUnknownSync(
              Schema.Struct({ message: Schema.Struct({ content: Schema.String }) }),
            )(call.body);
            assert.equal(body.message.content, "Forum opener");
          },
        },
        reply.step,
      ];
    }),
    scenario("stay silent when the model only writes a plain answer", () => []),
  ];
}
