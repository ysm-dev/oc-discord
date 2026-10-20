import { BridgeError } from "../errors.ts";

export function dateBound(date: string) {
  const milliseconds = Date.parse(date) - 1420070400000;
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new BridgeError({
      message: "Search dates must be valid ISO dates on or after 2015-01-01",
      status: 400,
    });
  }
  return (BigInt(milliseconds) << 22n).toString();
}
