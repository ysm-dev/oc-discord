import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { runCi } from "./ci.ts";

const gates = [
  "format:check",
  "lint",
  "typecheck",
  "test",
  "knip",
  "dup",
  "exceptions",
  "verify-gates",
];
const originalCwd = process.cwd();
let directory = "";

const fixture = (overrides: Readonly<Record<string, string>> = {}): void => {
  writeFileSync(
    "package.json",
    JSON.stringify({
      scripts: Object.fromEntries(
        gates.map((gate, index) => {
          const file = `gate-${index}.ts`;
          writeFileSync(
            file,
            `import { appendFileSync } from "node:fs";
${overrides[gate] ?? ""}
appendFileSync("completed", ${JSON.stringify(`${gate}\n`)});
`,
          );
          return [gate, `bun ${file}`];
        }),
      ),
    }),
  );
};

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "ci-budget-"));
  process.chdir(directory);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(directory, { recursive: true, force: true });
});

test("local CI runs every gate in order", () => {
  fixture();
  expect(runCi()).toBe(0);
  expect(readFileSync("completed", "utf8").trim().split("\n")).toEqual(gates);
});

test("local CI fails immediately on a failing gate", () => {
  fixture({ lint: "process.exit(7);" });
  expect(runCi()).toBe(7);
  expect(readFileSync("completed", "utf8")).toBe("format:check\n");
});

test("local CI shares one deadline and stops descendants", async () => {
  fixture({
    "format:check": "await Bun.sleep(900);",
    lint: `Bun.spawn([process.execPath, "-e", 'await Bun.write("descendant-started", "yes"); await Bun.sleep(1200); await Bun.write("orphan", "alive");'], { stdio: ["ignore", "ignore", "ignore"] });
await Bun.sleep(900);`,
  });
  expect(runCi(1500)).toBe(124);
  expect(readFileSync("completed", "utf8")).toBe("format:check\n");
  expect(existsSync("descendant-started")).toBe(true);
  await Bun.sleep(1300);
  expect(existsSync("orphan")).toBe(false);
});
