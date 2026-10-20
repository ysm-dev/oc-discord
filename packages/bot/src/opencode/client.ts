import type { OpenCodeClient, SessionCreateInput } from "@opencode/client";
import { Context, Effect, Layer, Stream } from "effect";
import { BridgeError, networkError } from "../errors.ts";

const call = <T>(operation: (signal: AbortSignal) => Promise<T>) =>
  Effect.tryPromise({ try: operation, catch: (error) => networkError("OpenCode v2", error) });

function service(client: OpenCodeClient, directory: string) {
  const location = { directory };
  return {
    check: Effect.gen(function* () {
      const info = yield* call((signal) => client.server.info({ signal })).pipe(
        Effect.mapError((error) => {
          if (error.status === 404)
            return new BridgeError({
              message: "OpenCode v2 is required; check --opencode-url",
              status: 404,
            });
          return error.status === 502
            ? new BridgeError({
                message: "Cannot reach an OpenCode v2 server; check --opencode-url",
                status: 502,
              })
            : error;
        }),
      );
      if (!info.version.startsWith("2."))
        return yield* new BridgeError({ message: "OpenCode v2 is required", status: 400 });
      return yield* call((signal) => client.location.get({ location }, { signal })).pipe(
        Effect.mapError(
          () =>
            new BridgeError({
              message:
                "OpenCode v2 cannot see the Session directory; create it on the OpenCode machine and check --directory",
              status: 400,
            }),
        ),
      );
    }),
    files: () => call((signal) => client.file.list({ location }, { signal })),
    reload: () => call((signal) => client.location.reload({ signal })),
    ready: Effect.gen(function* () {
      for (let attempt = 0; attempt < 100; attempt++) {
        const plugins = yield* call((signal) => client.plugin.list({ location }, { signal }));
        const plugin = plugins.data.find((entry) => entry.id === "oc-discord");
        if (plugin?.state.status === "active") return yield* Effect.void;
        if (plugin?.state.status === "failed")
          return yield* new BridgeError({
            message: "OpenCode could not load the Discord plugin; inspect its plugin status",
            status: 502,
          });
        yield* Effect.sleep("100 millis");
      }
      return yield* new BridgeError({
        message: "OpenCode did not load the Discord plugin after directory setup",
        status: 502,
      });
    }),
    write: (path: string, content: string) =>
      call((signal) =>
        client.file.write(
          { location, path, payload: new TextEncoder().encode(content) },
          { signal },
        ),
      ),
    create: (input: SessionCreateInput) =>
      call((signal) => client.session.create({ ...input, location }, { signal })),
    get: (sessionID: string) => call((signal) => client.session.get({ sessionID }, { signal })),
    prompt: (sessionID: string, text: string) =>
      call((signal) => client.session.prompt({ sessionID, text }, { signal })),
    events: () =>
      Stream.fromAsyncIterable(client.event.subscribe(), (error) =>
        networkError("OpenCode event stream", error),
      ),
  };
}

export class OpenCode extends Context.Service<OpenCode, ReturnType<typeof service>>()(
  "oc-discord/OpenCode",
) {
  static layer(client: OpenCodeClient, directory: string) {
    return Layer.succeed(OpenCode, service(client, directory));
  }
}
