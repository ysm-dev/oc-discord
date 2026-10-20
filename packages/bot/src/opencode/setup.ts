import { Effect, Schema } from "effect";
import { catalog } from "../actions/catalog.ts";
import { installTools } from "../plugin/install.ts";
import { OpenCode } from "./client.ts";

const instructions = `# Discord

You are a member of this Discord server. Each session starts from one message that mentioned you; the prompt shows where it was posted and the messages before it.

- Before doing anything else in each Session, call \`discord_typing\` with the channel or thread ID where you were mentioned.
- People only see what you do with the \`discord_*\` tools. Your plain replies are never shown.
- Respond the way a person would: reply in the channel, start a thread for a longer conversation, react, or do nothing.
- Keep replies concise; add detail when someone asks for it.
- To look at an attachment, download it into this folder (for example with \`curl -o\`) and open it with \`read\`.
`;

const config = `{
  "$schema": "https://opencode.ai/config.json",
  "model": "opencode-go/deepseek-v4.1-flash",
  // Every rule must be allow or deny: nothing in Discord can answer ask.
  "permissions": [
    { "action": "question", "resource": "*", "effect": "deny" },
    { "action": "read", "resource": "*.env", "effect": "deny" },
    { "action": "read", "resource": "*.env.*", "effect": "deny" },
    { "action": "read", "resource": "*.env.example", "effect": "allow" },
    { "action": "external_directory", "resource": "*", "effect": "deny" }
  ]
}
`;

export const setupDirectory = Effect.gen(function* () {
  const opencode = yield* OpenCode;
  yield* opencode.check;
  const files = yield* opencode.files();
  for (const [path, content] of [
    ["AGENTS.md", instructions],
    ["opencode.jsonc", config],
  ] as const) {
    if (!files.data.some((file) => file.path === path)) yield* opencode.write(path, content);
  }
  const tools = catalog.map(({ name, description, input }) => ({
    name,
    description,
    input: Schema.toJsonSchemaDocument(input).schema,
  }));
  // The runtime is self-contained: serialization leaves no Bridge package dependencies.
  const source = `import { Plugin } from "@opencode/plugin";\nimport { readFile, realpath, stat } from "node:fs/promises";\nconst io = { canonical: realpath, read: (path, signal) => readFile(path, { signal }), size: async (path) => (await stat(path)).size };\n${installTools.toString()}\nexport default Plugin.define({ id: "oc-discord", setup(ctx) { return installTools(ctx, ${JSON.stringify(tools)}, io); } });\n`;
  yield* opencode.write(".opencode/plugins/oc-discord.ts", source);
  yield* opencode.reload();
  yield* opencode.ready;
});
