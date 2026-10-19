import { expect, it } from "vitest";
import { main } from "./main.ts";

it("reports that the bot is not configured", () => {
  expect(main()).toBe("oc-discord bot is not configured yet.");
});
