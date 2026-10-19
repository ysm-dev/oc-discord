import { REST, type RESTOptions } from "@discordjs/rest";
import { Schema } from "effect";
import { ChannelType } from "discord-api-types/v10";
import type { Member } from "../src/discord/models.ts";
import type { Channel, Message, User } from "../src/discord/models.ts";
import { restResponse } from "./http.ts";

export const bot: User = {
  id: "100000000000000001",
  username: "bridge",
  global_name: "Bridge",
  bot: true,
};
export const alice: User = { id: "100000000000000002", username: "alice", global_name: "Alice" };
export const guildId = "200000000000000001";
export const channelId = "300000000000000001";
export const threadId = "300000000000000002";
export function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "400000000000000001",
    channel_id: channelId,
    guild_id: guildId,
    author: alice,
    content: `<@${bot.id}> hello`,
    timestamp: "2026-10-20T12:00:00.000Z",
    mentions: [bot],
    attachments: [],
    embeds: [],
    ...overrides,
  };
}

interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: Schema.Json;
  files: File[];
}

export class FakeDiscord {
  readonly channels = new Map<string, Channel>([
    [channelId, { id: channelId, guild_id: guildId, name: "general", topic: "Welcome", type: 0 }],
    [
      threadId,
      { id: threadId, guild_id: guildId, name: "discussion", type: 11, parent_id: channelId },
    ],
  ]);
  readonly messages = new Map<string, Message>([
    [
      "400000000000000000",
      message({ id: "400000000000000000", content: "Earlier conversation", mentions: [] }),
    ],
  ]);
  readonly calls: Call[] = [];
  readonly failures = new Map<string, number>();
  member: typeof Member.Type = {
    user: alice,
    nick: "Ali",
    roles: ["600000000000000001"],
    joined_at: "2026-01-01T00:00:00Z",
  };
  searchIndexing = 0;
  malformed = false;
  private sequence = 500000000000000000n;

  readonly request: RESTOptions["makeRequest"] = async (url, init) => {
    const target = new URL(url);
    const method = init.method ?? "GET";
    const path = target.pathname.replace("/api/v10", "");
    let body: Schema.Json = null;
    const files: File[] = [];
    if (typeof init.body === "string")
      body = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(init.body);
    if (init.body instanceof FormData) {
      body = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(
        init.body.get("payload_json"),
      );
      for (const value of init.body.values()) if (value instanceof File) files.push(value);
    }
    const call = { method, path, query: target.searchParams, body, files };
    this.calls.push(call);
    return restResponse(this.respond(call));
  };

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const form = request.headers.get("content-type")?.startsWith("multipart/")
      ? await request.formData()
      : undefined;
    const text = form?.get("payload_json") ?? (await request.text());
    const body = text ? Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(text) : null;
    const values = form
      ? Schema.decodeUnknownSync(
          Schema.Array(Schema.Union([Schema.String, Schema.instanceOf(File)])),
        )([...form.values()])
      : [];
    const files = values.filter((value) => typeof value !== "string");
    const call = {
      method: request.method,
      path: url.pathname.replace("/api/v10", ""),
      query: url.searchParams,
      body,
      files,
    };
    this.calls.push(call);
    return this.respond(call);
  }

  client() {
    return new REST({
      version: "10",
      makeRequest: this.request,
      retries: 0,
      globalRequestsPerSecond: 1_000_000,
    }).setToken("discord-secret");
  }

  private respond(call: Call): Response {
    const status = this.failures.get(call.path);
    if (status) return Response.json({ code: status, message: "SECRET response body" }, { status });
    if (this.malformed) return Response.json({ invalid: true });
    if (call.path === "/users/@me") return Response.json(bot);
    if (call.path === "/oauth2/applications/@me")
      return Response.json({ id: bot.id, verify_key: "a".repeat(64) });
    if (call.path === `/guilds/${guildId}`)
      return Response.json({ id: guildId, name: "Our server" });
    if (call.path.endsWith("/threads/active"))
      return Response.json({
        threads: [...this.channels.values()].filter(
          (channel) => channel.type === ChannelType.PublicThread,
        ),
      });
    if (call.path.endsWith("/channels"))
      return Response.json(
        [...this.channels.values()].filter((channel) => channel.type !== ChannelType.PublicThread),
      );
    if (call.path.endsWith("/roles"))
      return Response.json([{ id: "600000000000000001", name: "Members" }]);
    if (call.path.includes("/members/")) return Response.json(this.member);
    if (call.path.endsWith("/messages/search")) {
      if (this.searchIndexing-- > 0)
        return Response.json({ code: 110000, retry_after: 0.001 }, { status: 202 });
      return Response.json({
        total_results: this.messages.size,
        messages: [...this.messages.values()].map((item) => [item]),
      });
    }
    return this.channelCall(call);
  }

  private channelCall(call: Call): Response {
    const [, , target, resource, id] = call.path.split("/");
    if (!target || !this.channels.has(target))
      return Response.json({ message: "Unknown channel", code: 10003 }, { status: 404 });
    if (!resource) return Response.json(this.channels.get(target));
    if (resource === "typing" || call.path.includes("/reactions/"))
      return new Response(null, { status: 204 });
    if (call.path.endsWith("/threads")) return this.createThread(call, target);
    if (resource !== "messages") throw new Error(`Unhandled Discord route ${call.path}`);
    if (call.method === "POST") return this.post(call, target);
    if (id) {
      const item = this.messages.get(id);
      if (!item) return Response.json({ message: "Unknown message", code: 10008 }, { status: 404 });
      if (call.method === "DELETE") {
        this.messages.delete(id);
        return new Response(null, { status: 204 });
      }
      if (call.method === "PATCH") {
        const body = Schema.decodeUnknownSync(Schema.Struct({ content: Schema.String }))(call.body);
        const edited = { ...item, content: body.content };
        this.messages.set(id, edited);
        return Response.json(edited);
      }
      return Response.json(item);
    }
    const before = call.query.get("before");
    const after = call.query.get("after");
    return Response.json(
      [...this.messages.values()]
        .filter(
          (item) =>
            item.channel_id === target &&
            (!before || item.id < before) &&
            (!after || item.id > after),
        )
        .toSorted((a, b) => (BigInt(a.id) > BigInt(b.id) ? -1 : 1))
        .slice(0, Number(call.query.get("limit") ?? 50)),
    );
  }

  private post(call: Call, target: string): Response {
    const body = Schema.decodeUnknownSync(Schema.Struct({ content: Schema.String }))(call.body);
    const item = message({
      id: String(++this.sequence),
      channel_id: target,
      content: body.content,
      author: bot,
    });
    this.messages.set(item.id, item);
    return Response.json(item);
  }

  private createThread(call: Call, target: string): Response {
    const body = Schema.decodeUnknownSync(Schema.Struct({ name: Schema.String }))(call.body);
    const thread: Channel = {
      id: String(++this.sequence),
      name: body.name,
      guild_id: guildId,
      parent_id: target,
      type: 11,
    };
    this.channels.set(thread.id, thread);
    return Response.json(thread);
  }
}
