import { spawnSync } from "bun";
import process from "node:process";

/** One deadline for the entire sequence, including subprocess startup. */
export const runCi = (timeoutMs = 5 * 60 * 1000): number => {
  const result = spawnSync({
    cmd: [
      process.execPath,
      "--no-orphans",
      "run",
      "--sequential",
      "format:check",
      "lint",
      "typecheck",
      "test",
      "knip",
      "dup",
      "exceptions",
      "verify-gates",
    ],
    stdio: ["inherit", "inherit", "inherit"],
    timeout: timeoutMs,
  });

  if (result.exitedDueToTimeout) {
    process.stderr.write(`ERROR CI duration: exceeded ${timeoutMs / 1000}s budget\n`);
    return 124;
  }
  return result.success ? 0 : result.exitCode || 1;
};

if (import.meta.main) {
  process.exitCode = runCi();
}
