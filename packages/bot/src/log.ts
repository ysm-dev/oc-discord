import type { Logger } from "chat";
import { Context, Layer } from "effect";
import { redact } from "./settings.ts";

type Fields = Readonly<Record<string, string | number>>;
export class Log extends Context.Service<
  Log,
  {
    write: (event: string, fields?: Fields) => void;
    chat: Logger;
  }
>()("oc-discord/Log") {
  static layer(output: (line: string) => void, secrets: readonly string[]) {
    const write = (event: string, fields: Fields = {}) =>
      output(redact(JSON.stringify({ event, ...fields }), secrets));
    // Chat SDK includes message text in its arguments. Only its fixed diagnostic labels are retained.
    const chat: Logger = {
      child: () => chat,
      debug: () => {},
      info: () => {},
      warn: () => write("discord.receiving.warning"),
      error: () => write("discord.receiving.error"),
    };
    return Layer.succeed(Log, { write, chat });
  }
}
