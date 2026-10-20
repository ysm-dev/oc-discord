import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { Config, Context, Effect, Redacted, Schema } from "effect";
import { Command, Flag } from "effect/cli";
import { BridgeError } from "./errors.ts";
import pkg from "../package.json" with { type: "json" };

function text(name: string, env: string, description: string, fallback: string) {
  return Flag.String(name).pipe(
    Flag.withFallbackConfig(Config.String(env)),
    Flag.withDefault(fallback),
    Flag.withDescription(`${description}. ${env}; default: ${fallback}`),
  );
}

function secret(name: string, env: string) {
  return Flag.Redacted(name).pipe(
    Flag.withFallbackConfig(Config.Redacted(env)),
    Flag.withDescription(`${env}; required`),
  );
}

const flags = {
  opencodeUrl: Flag.String("opencode-url").pipe(
    Flag.withFallbackConfig(Config.String("OPENCODE_URL")),
    Flag.withDescription("OpenCode v2 server URL. OPENCODE_URL; required"),
  ),
  password: secret("opencode-password", "OPENCODE_PASSWORD"),
  token: secret("discord-bot-token", "DISCORD_BOT_TOKEN"),
  directory: text(
    "directory",
    "OC_DISCORD_DIRECTORY",
    "Session directory on OpenCode",
    "~/discord-bot",
  ),
  history: text("history", "OC_DISCORD_HISTORY", "Recent messages per Briefing", "50"),
  port: text("port", "OC_DISCORD_PORT", "HTTP port", "4097"),
  host: text("host", "OC_DISCORD_HOST", "Listening address", "127.0.0.1"),
  bridgeUrl: text(
    "bridge-url",
    "OC_DISCORD_BRIDGE_URL",
    "URL OpenCode uses to reach the Bridge",
    "http://127.0.0.1:<port>",
  ),
};

interface Input {
  opencodeUrl: string;
  password: Redacted.Redacted;
  token: Redacted.Redacted;
  directory: string;
  history: string;
  port: string;
  host: string;
  bridgeUrl: string;
}

export interface SettingsValue extends Omit<Input, "history" | "port"> {
  history: number;
  port: number;
}

export class Settings extends Context.Service<Settings, SettingsValue>()("oc-discord/Settings") {}

const httpUrl = Schema.String.check(
  Schema.isPattern(/^https?:\/\//),
  Schema.makeFilter((value) => URL.canParse(value)),
);
const integer = (min: number, max: number) =>
  Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: min, maximum: max }));

const validateSettings = Effect.fnUntraced(function* (input: Input) {
  const values = yield* Schema.decodeUnknownEffect(
    Schema.Struct({
      opencodeUrl: httpUrl,
      bridgeUrl: httpUrl,
      history: integer(0, Number.MAX_SAFE_INTEGER),
      port: integer(1, 65535),
      host: Schema.NonEmptyString,
    }),
  )({ ...input, bridgeUrl: input.bridgeUrl.replace("<port>", input.port) }).pipe(
    Effect.mapError(
      () =>
        new BridgeError({
          message:
            "Invalid settings: use HTTP(S) URLs, nonnegative integer history, port 1–65535 and a nonempty host",
          status: 400,
        }),
    ),
  );
  const directory =
    input.directory === "~" ? homedir() : input.directory.replace(/^~\//, `${homedir()}/`);
  if (!isAbsolute(directory) || !Redacted.value(input.password) || !Redacted.value(input.token)) {
    return yield* new BridgeError({
      message: "Session directory must be absolute; password and bot token must not be empty",
      status: 400,
    });
  }
  return { ...input, ...values, directory: resolve(directory) } satisfies SettingsValue;
});

export function cli<E, R>(start: (settings: SettingsValue) => Effect.Effect<void, E, R>) {
  return Command.make("oc-discord", flags, (input) =>
    validateSettings(input).pipe(Effect.flatMap(start)),
  ).pipe(
    Command.withDescription("Connect one Discord Bot to OpenCode v2"),
    Command.run({ version: pkg.version, renderErrors: false }),
    Effect.catch((error) =>
      Effect.fail(
        error instanceof BridgeError
          ? error
          : new BridgeError({ message: "Invalid command-line arguments; see --help", status: 400 }),
      ),
    ),
  );
}

export function redact(message: string, secrets: readonly string[]): string {
  return secrets
    .filter(Boolean)
    .reduce((line, value) => line.replaceAll(value, "[redacted]"), message);
}
