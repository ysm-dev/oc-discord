import type { JsonValue } from "@opencode/client";
import type { Plugin } from "@opencode/plugin";
import type { JsonSchema } from "effect";

interface Tool {
  name: string;
  description: string;
  input: JsonSchema.JsonSchema;
}
interface ToolContext {
  sessionID: string;
  signal: AbortSignal;
}
interface PluginContext {
  session: Pick<Plugin.Context["session"], "get">;
  tool: {
    transform: (
      edit: (editor: {
        add: (
          tool: Tool & {
            options: { codemode: false };
            execute: (
              input: Record<string, JsonValue>,
              context: ToolContext,
            ) => Promise<{ content: string }>;
          },
        ) => void;
      }) => void,
    ) => Promise<object>;
  };
}

interface Files {
  canonical: (path: string) => Promise<string>;
  size: (path: string) => Promise<number>;
  read: (path: string, signal: AbortSignal) => Promise<Uint8Array>;
}

export async function installTools(ctx: PluginContext, catalog: readonly Tool[], io: Files) {
  async function rootSession(sessionID: string) {
    let session = await ctx.session.get({ sessionID });
    const visited = new Set<string>();
    while (session.parentID) {
      if (visited.has(session.id)) throw new Error("Invalid Session ancestry");
      visited.add(session.id);
      session = await ctx.session.get({ sessionID: session.parentID });
    }
    return session;
  }

  async function attachFiles(
    body: FormData,
    directory: string,
    files: JsonValue | undefined,
    signal: AbortSignal,
  ) {
    if (!Array.isArray(files)) return;
    if (files.length > 10) throw new Error("At most 10 files can be attached");
    const root = await io.canonical(directory);
    for (const path of files) await attachFile(body, directory, root, path, signal);
  }

  async function attachFile(
    body: FormData,
    directory: string,
    root: string,
    path: JsonValue,
    signal: AbortSignal,
  ) {
    if (typeof path !== "string") throw new Error("File paths must be strings");
    const relative = path.startsWith(`${directory}/`) ? path.slice(directory.length + 1) : path;
    if (
      !relative ||
      relative.startsWith("/") ||
      relative.includes("\\") ||
      relative.split("/").includes("..")
    ) {
      throw new Error("Files must be inside the Session directory");
    }
    const canonical = await io.canonical(`${directory}/${relative}`);
    if (!canonical.startsWith(`${root}/`))
      throw new Error("Files must be inside the Session directory");
    if ((await io.size(canonical)) > 20 * 1024 * 1024)
      throw new Error("Files must not exceed 20 MiB");
    const bytes = await io.read(canonical, signal);
    if (bytes.length > 20 * 1024 * 1024) throw new Error("Files must not exceed 20 MiB");
    body.append("files", new Blob([new Uint8Array(bytes)]), relative.split("/").pop());
  }

  async function runTool(name: string, input: Record<string, JsonValue>, context: ToolContext) {
    const session = await rootSession(context.sessionID);
    const metadata = session.metadata?.["discord"];
    if (
      !metadata ||
      typeof metadata !== "object" ||
      Array.isArray(metadata) ||
      typeof metadata["bridgeUrl"] !== "string" ||
      typeof metadata["key"] !== "string"
    ) {
      throw new Error("This Session was not started by oc-discord");
    }
    const body = new FormData();
    body.set("call", JSON.stringify({ name, args: input }));
    await attachFiles(body, session.location.directory, input["files"], context.signal);
    const response = await fetch(
      `${metadata["bridgeUrl"].replace(/\/$/, "")}/actions/${encodeURIComponent(context.sessionID)}`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${metadata["key"]}` },
        body,
        signal: context.signal,
      },
    );
    return { content: await response.text() };
  }

  await ctx.tool.transform((editor) => {
    for (const tool of catalog)
      editor.add({
        ...tool,
        options: { codemode: false },
        execute: (input, context) => runTool(tool.name, input, context),
      });
  });
}
