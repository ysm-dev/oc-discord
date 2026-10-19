import { expect, it } from "vitest";
import { allowedMentions, splitText } from "./text.ts";

it.each([
  "",
  "a".repeat(2000),
  "a".repeat(2001),
  `${"a".repeat(1999)}😀tail`,
  `${"a".repeat(1500)}\n${"b".repeat(1500)}`,
  "word ".repeat(1000),
])("splitting preserves Unicode and all text (%#)", (input) => {
  const chunks = splitText(input);
  expect(chunks.join("")).toBe(input);
  expect(
    chunks.every(
      (chunk) =>
        chunk.length <= 2000 && new TextDecoder().decode(new TextEncoder().encode(chunk)) === chunk,
    ),
  ).toBe(true);
});

it("only actual user mention codes can ping, and the API's user cap is respected", () => {
  const content = Array.from({ length: 110 }, (_, index) => `<@${index}>`).join(" ");
  expect(allowedMentions(content, false).users).toHaveLength(100);
  expect(allowedMentions("<@1> <@!1> <@&2> @everyone @here", true)).toEqual({
    parse: [],
    users: ["1"],
    replied_user: true,
  });
});
