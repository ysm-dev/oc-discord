import { expect, it } from "vitest";
import { gatewayUrl } from "./settings.ts";

it.each([
  ["127.0.0.1", "http://127.0.0.1:4097/gateway"],
  ["0.0.0.0", "http://127.0.0.1:4097/gateway"],
  ["::", "http://[::1]:4097/gateway"],
  ["::1", "http://[::1]:4097/gateway"],
  ["2001:db8::1", "http://[2001:db8::1]:4097/gateway"],
  ["localhost", "http://localhost:4097/gateway"],
])("Gateway forwarding reaches the Bridge listening on %s", (host, expected) => {
  const url = gatewayUrl(host, 4097);
  expect(url).toBe(expected);
  expect(new URL(url).pathname).toBe("/gateway");
});
