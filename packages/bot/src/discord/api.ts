import { REST, RequestMethod, type RequestData, type RouteLike } from "@discordjs/rest";
import { Context, Effect, Layer, Schema } from "effect";
import { BridgeError, networkError } from "../errors.ts";
import { Application, Channel, Guild, Member, Message, Roles, Threads, User } from "./models.ts";
import { allowedMentions, splitText } from "./text.ts";

function makeApi(rest: REST) {
  function request<T>(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    path: RouteLike,
    schema: Schema.Decoder<T>,
    options: RequestData = {},
  ) {
    const methods = {
      GET: RequestMethod.Get,
      POST: RequestMethod.Post,
      PATCH: RequestMethod.Patch,
      PUT: RequestMethod.Put,
      DELETE: RequestMethod.Delete,
    };
    return Effect.tryPromise({
      try: (signal) =>
        rest.request({ ...options, method: methods[method], fullRoute: path, signal }),
      catch: (error) => networkError("Discord", error),
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(schema)),
      Effect.mapError((error) =>
        error instanceof BridgeError
          ? error
          : new BridgeError({ message: "Discord returned an invalid response", status: 502 }),
      ),
    );
  }
  const get = <T>(path: RouteLike, schema: Schema.Decoder<T>, query = new URLSearchParams()) =>
    request("GET", path, schema, { query });
  const messages = (channelId: string, query: URLSearchParams) =>
    get(`/channels/${channelId}/messages`, Schema.Array(Message), query);
  const send = Effect.fnUntraced(function* (
    channelId: string,
    content: string,
    replyTo?: string,
    files: { name: string; data: Uint8Array }[] = [],
  ) {
    if (
      files.length > 10 ||
      files.some((file) => Buffer.byteLength(file.data) > 20 * 1024 * 1024)
    ) {
      return yield* new BridgeError({
        message: "Use at most 10 files, each no larger than 20 MiB",
        status: 400,
      });
    }
    if (!content && !files.length)
      return yield* new BridgeError({ message: "Provide content or files", status: 400 });
    const ids: string[] = [];
    for (const [index, chunk] of splitText(content).entries()) {
      const message = yield* request("POST", `/channels/${channelId}/messages`, Message, {
        body: {
          content: chunk,
          allowed_mentions: allowedMentions(chunk, index === 0 && !!replyTo),
          ...(index === 0 && replyTo ? { message_reference: { message_id: replyTo } } : {}),
        },
        files: index === 0 ? files : [],
      });
      ids.push(message.id);
    }
    return ids;
  });
  return {
    identity: Effect.all({
      bot: get("/users/@me", User),
      application: get("/oauth2/applications/@me", Application),
    }),
    channel: (id: string) => get(`/channels/${id}`, Channel),
    guild: (id: string) => get(`/guilds/${id}`, Guild),
    channels: (id: string) => get(`/guilds/${id}/channels`, Schema.Array(Channel)),
    threads: (id: string) => get(`/guilds/${id}/threads/active`, Threads),
    roles: (id: string) => get(`/guilds/${id}/roles`, Roles),
    member: (guildId: string, userId: string) =>
      get(`/guilds/${guildId}/members/${userId}`, Member),
    message: (channelId: string, id: string) =>
      get(`/channels/${channelId}/messages/${id}`, Message),
    messages,
    send,
    request,
    get,
    typing: (id: string) => request("POST", `/channels/${id}/typing`, Schema.Void),
    history: Effect.fnUntraced(function* (channelId: string, before: string, count: number) {
      const result: Message[] = [];
      while (result.length < count) {
        const page = yield* messages(
          channelId,
          new URLSearchParams({ before, limit: String(Math.min(100, count - result.length)) }),
        );
        if (!page.length) break;
        result.push(...page);
        before = page[page.length - 1]!.id;
      }
      return result.toReversed();
    }),
  };
}

export class DiscordApi extends Context.Service<DiscordApi, ReturnType<typeof makeApi>>()(
  "oc-discord/DiscordApi",
) {
  static layer(rest: REST) {
    return Layer.succeed(DiscordApi, makeApi(rest));
  }
}
