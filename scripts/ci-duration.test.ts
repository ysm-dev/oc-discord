import { expect, test } from "bun:test";
import { verifyCiDuration } from "./ci-duration.ts";

test("CI duration rejects a job with GitHub's default timeout", () => {
  expect(verifyCiDuration("jobs:\n  gates:\n    runs-on: ubuntu-latest\n")).toContain(
    "CI duration: every job needs an integer timeout-minutes between 1 and 5",
  );
});

test.each(["1", "5"])("CI duration accepts a %s-minute job", (minutes) => {
  expect(verifyCiDuration(`jobs:\n  gates:\n    timeout-minutes: ${minutes}\n`)).toEqual([]);
});

test.each(["6", "0", "-1", "1.5", '"5"', "null", "${{ 5 }}"])(
  "CI duration rejects timeout-minutes: %s",
  (minutes) => {
    expect(verifyCiDuration(`jobs:\n  gates:\n    timeout-minutes: ${minutes}\n`)).toHaveLength(1);
  },
);

test.each([
  "",
  "null",
  "jobs: {}",
  "jobs: []",
  "jobs: null",
  "jobs: false",
  "jobs:\n  gates: null",
])("CI duration fails closed for invalid workflow: %s", (source) => {
  expect(verifyCiDuration(source)).toHaveLength(1);
});

test("CI duration rejects malformed YAML", () => {
  expect(() => verifyCiDuration("jobs: [")).toThrow();
});

test("CI duration checks every independent job", () => {
  expect(verifyCiDuration("jobs:\n  fast:\n    timeout-minutes: 1\n  slow: {}\n")).toHaveLength(1);
  expect(
    verifyCiDuration("jobs:\n  fast:\n    timeout-minutes: 1\n  slow:\n    timeout-minutes: 5\n"),
  ).toEqual([]);
});

test("CI duration rejects dependent jobs even when each has a five-minute timeout", () => {
  expect(
    verifyCiDuration(
      "jobs:\n  first:\n    timeout-minutes: 5\n  second:\n    timeout-minutes: 5\n    needs: first\n",
    ),
  ).toContain("CI duration: jobs must run independently (needs is forbidden)");
});
