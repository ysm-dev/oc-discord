import { Option, Schema } from "effect";

export class BridgeError extends Schema.TaggedError<BridgeError>()("BridgeError", {
  message: Schema.String,
  status: Schema.Number,
}) {}

// oxlint-disable-next-line typescript/no-restricted-types -- trust boundary: external failures are reduced to status codes, never response bodies or message text
export function networkError(system: string, error: unknown): BridgeError {
  const parsed = Schema.decodeUnknownOption(
    Schema.Union([
      Schema.Struct({ status: Schema.Number }),
      Schema.Struct({ cause: Schema.Struct({ status: Schema.Number }) }),
      Schema.Struct({ name: Schema.String }),
    ]),
  )(error);
  const value = Option.getOrElse(parsed, () => ({ name: "Error" }));
  const statuses: Record<string, number> = {
    UnauthorizedError: 401,
    InvalidRequestError: 400,
    SessionNotFoundError: 404,
    LocationNotFoundError: 404,
    ServiceUnavailableError: 503,
  };
  const status =
    "status" in value
      ? value.status
      : "cause" in value
        ? value.cause.status
        : (statuses[value.name] ?? 502);
  const hints: Record<number, string> = {
    401: "check credentials",
    403: "missing permission",
    404: "resource not found or not visible",
    429: "rate limited; try again later",
  };
  return new BridgeError({
    message: `${system}: ${hints[status] ?? "request failed"} (HTTP ${status})`,
    status,
  });
}
