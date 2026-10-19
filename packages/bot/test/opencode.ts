import { OpenCode, type JsonValue, type SessionInfo } from "@opencode/client";
import { Option, Schema } from "effect";
import { runInNewContext } from "node:vm";
import type { installTools } from "../src/plugin/install.ts";
import { Metadata } from "../src/sessions/metadata.ts";

type PluginContext = Parameters<typeof installTools>[0];
type Tool = Parameters<Parameters<PluginContext["tool"]["transform"]>[0]>[0] extends {
  add: (tool: infer T) => void;
}
  ? T
  : never;

export function session(id: string, extra: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    projectID: "prj_test",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
    location: { directory: "/discord-bot" },
    ...extra,
  };
}

const create = Schema.Struct({
  title: Schema.String,
  metadata: Schema.Struct({ discord: Metadata }),
  location: Schema.Struct({ directory: Schema.String }),
});
const plugin = Schema.Struct({
  setup: Schema.declare(
    (value): value is (ctx: PluginContext) => Promise<void> => typeof value === "function",
  ),
});

export class FakeOpenCode {
  readonly sessions = new Map<string, SessionInfo>();
  readonly prompts = new Map<string, string>();
  readonly files = new Map<string, string>();
  readonly tools = new Map<string, Tool>();
  readonly failures = new Map<string, number>();
  readonly requests: Request[] = [];
  private streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  version = "2.0.32";
  connections = 0;
  pluginState: "active" | "failed" | "missing" = "active";
  pluginDelay = 0;
  readonly client = OpenCode.make({
    baseUrl: "http://opencode.test",
    fetch: Object.assign(
      (input: string | URL | Request, init?: RequestInit) => this.fetch(new Request(input, init)),
      { preconnect: () => {} },
    ),
  });

  async fetch(request: Request): Promise<Response> {
    this.requests.push(request.clone());
    const url = new URL(request.url);
    const failure = this.failures.get(url.pathname);
    if (failure)
      return Response.json(
        {
          _tag: failure === 401 ? "UnauthorizedError" : "LocationNotFoundError",
          message: "PRIVATE error body",
        },
        { status: failure },
      );
    switch (url.pathname) {
      case "/api/info":
        return Response.json({ version: this.version, pid: 1, urls: [], paths: { tmp: "/tmp" } });
      case "/api/location":
        return Response.json({ directory: "/discord-bot" });
      case "/api/location/reload":
        return new Response(null, { status: 204 });
      case "/api/plugin":
        return Response.json({
          location: { directory: "/discord-bot" },
          data:
            this.pluginState === "missing" || this.pluginDelay-- > 0
              ? []
              : [{ id: "oc-discord", state: { status: this.pluginState } }],
        });
      case "/api/fs/list":
        return Response.json({
          location: { directory: "/discord-bot" },
          data: [...this.files.keys()].map((path) => ({ path, type: "file" })),
        });
      case "/api/experimental/fs/write": {
        const path = url.searchParams.get("path")!;
        this.files.set(path, await request.text());
        return Response.json({ location: { directory: "/discord-bot" }, data: { path } });
      }
      case "/api/fs/read":
        return new Response(this.files.get(url.searchParams.get("path")!) ?? "file contents");
      case "/api/event":
        return this.events(request.signal);
      case "/api/session": {
        const body = Schema.decodeUnknownSync(create)(await request.json());
        const item = session(`ses_${this.sessions.size + 1}`, {
          title: body.title,
          metadata: body.metadata,
          location: body.location,
        });
        this.sessions.set(item.id, item);
        return Response.json({ data: item });
      }
      default:
        return this.sessionRoute(request, url.pathname);
    }
  }

  private async sessionRoute(request: Request, path: string) {
    const id = path.split("/")[3]!;
    const item = this.sessions.get(id);
    if (!item)
      return Response.json({ _tag: "SessionNotFoundError", message: "not found" }, { status: 404 });
    if (path.endsWith("/prompt")) {
      const body = Schema.decodeUnknownSync(Schema.Struct({ text: Schema.String }))(
        await request.json(),
      );
      this.prompts.set(id, body.text);
      return Response.json({ data: { id: "msg_prompt" } });
    }
    return Response.json({ data: item });
  }

  private events(signal: AbortSignal) {
    this.connections++;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.streams.add(controller);
        controller.enqueue(
          new TextEncoder().encode('data: {"type":"server.connected","data":{}}\n\n'),
        );
        signal.addEventListener(
          "abort",
          () => {
            if (this.streams.delete(controller)) controller.close();
          },
          { once: true },
        );
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream" } });
  }

  emit(type: string, data: Record<string, JsonValue>) {
    for (const controller of this.streams)
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type, data })}\n\n`));
  }

  finish(id: string, outcome: "succeeded" | "failed" | "interrupted") {
    const item = this.sessions.get(id)!;
    this.sessions.set(id, { ...item, outcome });
    this.emit(`session.execution.${outcome}`, {
      sessionID: id,
      error: { status: 503, message: "PRIVATE text" },
      reason: "user",
    });
  }

  disconnect(failed = false) {
    for (const controller of this.streams) {
      if (failed) controller.error(new Error("PRIVATE transport error"));
      else controller.close();
    }
    this.streams.clear();
  }

  async loadPlugin() {
    const source = this.files.get(".opencode/plugins/oc-discord.ts")!;
    const loaded = Schema.decodeUnknownSync(plugin)(
      runInNewContext(
        source
          .replace(
            'import { Plugin } from "@opencode/plugin";',
            "const Plugin = { define: (value) => value };",
          )
          .replace('import { readFile, realpath, stat } from "node:fs/promises";', "")
          .replace("export default", ""),
        {
          FormData,
          Blob,
          Uint8Array,
          fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
          readFile: (path: string) => this.io.read(path, new AbortController().signal),
          realpath: this.io.canonical,
          stat: async (path: string) => ({ size: await this.io.size(path) }),
        },
      ),
    );
    await loaded.setup(this.context());
  }

  context(): PluginContext {
    return {
      session: this.client.session,
      tool: {
        transform: async (edit) => {
          edit({ add: (tool) => this.tools.set(tool.name, tool) });
          return {};
        },
      },
    };
  }

  readonly io: Parameters<typeof installTools>[2] = {
    canonical: (path) => Promise.resolve(path),
    size: (path) => Promise.resolve(this.files.get(path.replace("/discord-bot/", ""))?.length ?? 0),
    read: (path) =>
      Promise.resolve(
        new TextEncoder().encode(this.files.get(path.replace("/discord-bot/", "")) ?? ""),
      ),
  };

  call(name: string, args: Record<string, JsonValue>, id = "ses_1") {
    return this.tools
      .get(name)!
      .execute(args, { sessionID: id, signal: new AbortController().signal });
  }

  key(id: string) {
    const metadata = Schema.decodeUnknownOption(Metadata)(
      this.sessions.get(id)?.metadata?.["discord"],
    );
    return Option.isSome(metadata) ? metadata.value.key : "";
  }
}
