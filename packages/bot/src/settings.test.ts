import { homedir } from "node:os";
import { expect, it } from "vitest";
import {
  ConfigProvider,
  Console,
  Effect,
  FileSystem,
  Layer,
  Path,
  Sink,
  Stdio,
  Terminal,
} from "effect";
import { ChildProcessSpawner } from "effect/process";
import { cli, redact, type SettingsValue } from "./settings.ts";

const credentials = {
  OPENCODE_URL: "http://opencode.test",
  OPENCODE_PASSWORD: "secret",
  DISCORD_BOT_TOKEN: "token",
};
it("settings expand the Bridge machine's home, derive the callback port and accept explicit URLs", async () => {
  const config = (await command(["--directory", "~/discord-bot", "--port", "5000"], credentials))
    .configs[0]!;
  expect(config.directory).toBe(`${homedir()}/discord-bot`);
  expect(config.bridgeUrl).toBe("http://127.0.0.1:5000");
  expect(
    (await command(["--directory", "~", "--history", "0"], credentials)).configs[0]?.directory,
  ).toBe(homedir());
});

it.each([
  ["port", "65536"],
  ["history", "-1"],
  ["history", "1.5"],
  ["opencode-url", "file:///secret"],
  ["opencode-url", "http://[bad"],
  ["directory", "relative"],
  ["opencode-password", ""],
  ["discord-bot-token", ""],
])("invalid settings fail without echoing values (%#)", async (flag, value) => {
  await expect(command([`--${flag}=${value}`], credentials)).rejects.toThrow(
    /Invalid settings|must be absolute/,
  );
});

async function command(args: string[], env: Record<string, string> = {}) {
  const output: string[] = [];
  const configs: SettingsValue[] = [];
  const sink = Sink.forEach((chunk: string | Uint8Array) =>
    Effect.sync(() => {
      output.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    }),
  );
  const services = Layer.mergeAll(
    FileSystem.layerNoop({}),
    Path.layer,
    Stdio.layerTest({ args: Effect.succeed(args), stdout: () => sink, stderr: () => sink }),
    Layer.succeed(Console.Console, {
      ...globalThis.console,
      log: (value: string) => {
        output.push(value);
      },
    }),
    Layer.succeed(
      Terminal.Terminal,
      Terminal.make({
        columns: Effect.succeed(80),
        rows: Effect.succeed(24),
        readInput: Effect.die("unused"),
        readLine: Effect.die("unused"),
        display: () => Effect.void,
      }),
    ),
    Layer.succeed(
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make(() => Effect.die("unused")),
    ),
    ConfigProvider.layer(ConfigProvider.fromUnknown(env)),
  );
  await Effect.runPromise(
    cli((value) =>
      Effect.sync(() => {
        configs.push(value);
      }),
    ).pipe(Effect.provide(services)),
  );
  return { output: output.join(""), configs };
}

it("flags override environment settings; every setting falls back to its environment variable", async () => {
  const result = await command(["--port", "5000"], {
    OPENCODE_URL: "https://opencode.test",
    OPENCODE_PASSWORD: "secret",
    DISCORD_BOT_TOKEN: "token",
    OC_DISCORD_PORT: "4098",
    OC_DISCORD_HOST: "0.0.0.0",
    OC_DISCORD_DIRECTORY: "/other",
    OC_DISCORD_HISTORY: "10",
    OC_DISCORD_BRIDGE_URL: "http://bridge.test",
  });
  expect(result.configs[0]).toMatchObject({
    port: 5000,
    directory: "/other",
    history: 10,
    host: "0.0.0.0",
    bridgeUrl: "http://bridge.test",
  });
  const defaults = await command([
    "--opencode-url",
    "http://local",
    "--opencode-password",
    "pw",
    "--discord-bot-token",
    "token",
  ]);
  expect(defaults.configs[0]).toMatchObject({
    port: 4097,
    history: 50,
    directory: `${homedir()}/discord-bot`,
  });
});

it("help lists defaults and environment variables; version needs no credentials", async () => {
  expect((await command(["--help"])).output).toMatch(
    /OPENCODE_URL[\s\S]*OC_DISCORD_HISTORY[\s\S]*4097/,
  );
  expect((await command(["--version"])).output).toContain("0.1.0");
});

it("invalid CLI input never prints secret values, and settings errors retain their actionable message", async () => {
  await expect(command(["--nonsense", "secret-value"])).rejects.toThrow(
    "Invalid command-line arguments",
  );
  await expect(
    command([
      "--opencode-url",
      "invalid",
      "--opencode-password",
      "secret",
      "--discord-bot-token",
      "token",
    ]),
  ).rejects.toThrow("Invalid settings");
  expect(redact("token secret secret", ["", "secret", "token"])).toBe(
    "[redacted] [redacted] [redacted]",
  );
});
