import { Effect, Schema } from "effect";
import { HttpServerResponse } from "effect/http";
import { BridgeError } from "../errors.ts";
import { authorize } from "../sessions/metadata.ts";
import { Action } from "./catalog.ts";
import { executeAction } from "./execute.ts";

export const handleAction = Effect.fnUntraced(function* (
  request: Request,
  sessionId: string,
  botId: string,
) {
  const token = request.headers.get("authorization");
  if (!token?.startsWith("Bearer "))
    return yield* new BridgeError({ message: "Session key required", status: 401 });
  const auth = yield* authorize(sessionId, token.slice(7));
  const form = yield* Effect.tryPromise(() => request.formData()).pipe(
    Effect.mapError(
      () =>
        new BridgeError({
          message: "Send multipart form data with a call field and optional files",
          status: 400,
        }),
    ),
  );
  const call = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Action))(
    form.get("call"),
  ).pipe(
    Effect.mapError(
      () =>
        new BridgeError({
          message: "Invalid Action or parameters; check the tool's parameter descriptions",
          status: 400,
        }),
    ),
  );
  const uploads = yield* Schema.decodeUnknownEffect(
    Schema.Array(
      Schema.instanceOf(File).check(Schema.makeFilter((file) => file.size <= 20 * 1024 * 1024)),
    ).check(Schema.isMaxLength(10)),
  )(form.getAll("files")).pipe(
    Effect.mapError(
      () =>
        new BridgeError({
          message: "Use at most 10 binary files, each no larger than 20 MiB",
          status: 400,
        }),
    ),
  );
  const files: { name: string; data: Uint8Array }[] = [];
  for (const file of uploads) {
    files.push({
      name: file.name,
      data: new Uint8Array(yield* Effect.promise(() => file.arrayBuffer())),
    });
  }
  const result = yield* executeAction(call, auth.metadata, auth.sessionId, botId, files);
  return HttpServerResponse.text(result);
});
