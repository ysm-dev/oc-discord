import { Chat } from "chat";
import { Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import { DiscordContentFormat } from "@chat-adapter/discord";
import { isMention, Message, type User } from "../discord/models.ts";
import { Log } from "../log.ts";
import { Settings } from "../settings.ts";
import { ReceivingAdapter } from "./adapter.ts";
import { ReceivingState } from "./state.ts";

const envelope = Schema.Struct({ type: Schema.String, data: Message });

export const makeReceiver = Effect.fnUntraced(function* (
  bot: User,
  application: { id: string; verify_key: string },
  mention: (message: Message) => void,
) {
  const settings = yield* Settings;
  const log = yield* Log;
  const adapter = new ReceivingAdapter({
    apiUrl: "https://discord.com/api/v10",
    botToken: Redacted.value(settings.token),
    applicationId: application.id,
    publicKey: application.verify_key,
    userName: bot.username,
    mentionRoleIds: [],
    respondToChannelIds: [],
    respondToGlobalMentions: false,
    contentFormat: DiscordContentFormat.Embeds,
    logger: log.chat,
  });
  const state = new ReceivingState();
  const chat = new Chat({
    userName: bot.username,
    adapters: { discord: adapter },
    state,
    concurrency: "concurrent",
    dedupeTtlMs: 60_000,
    logger: log.chat,
  });
  chat.onNewMention((_thread, message) => {
    mention(Schema.decodeUnknownSync(Message)(message.raw));
    return Promise.resolve();
  });
  yield* Effect.promise(() => chat.initialize());
  yield* Effect.addFinalizer(() => Effect.promise(() => state.disconnect()));
  return {
    adapter,
    handle: Effect.fnUntraced(function* (request: Request) {
      if (request.headers.get("x-discord-gateway-token") !== Redacted.value(settings.token)) {
        return new Response("Forwarded Gateway events only", { status: 401 });
      }
      const raw = yield* Effect.tryPromise(() => request.clone().json()).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(envelope)),
        Effect.option,
      );
      if (Option.isNone(raw) || !isMention(raw.value.type, raw.value.data, bot.id))
        return new Response("Ignored");
      return yield* Effect.promise(() => chat.webhooks.discord(request));
    }),
  };
});

export class Gateway extends Context.Service<
  Gateway,
  {
    listen: (
      adapter: ReceivingAdapter,
      duration: number,
      signal: AbortSignal,
      url: string,
    ) => Promise<void>;
  }
>()("oc-discord/Gateway") {
  static layer(listen: Gateway["Service"]["listen"]) {
    return Layer.succeed(Gateway, { listen });
  }
}
