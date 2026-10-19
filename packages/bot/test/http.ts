import type { ResponseLike } from "@discordjs/rest";
import { Schema } from "effect";

export function restResponse(response: Response): ResponseLike {
  return {
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    headers: response.headers,
    bodyUsed: response.bodyUsed,
    body: null,
    arrayBuffer: () => response.arrayBuffer(),
    text: () => response.text(),
    json: async () => Schema.decodeUnknownSync(Schema.Json)(await response.json()),
  };
}
