import { onTestFinished, vi, expect } from "vitest";
import { bridge } from "./bridge.ts";
import { message } from "./discord.ts";

export async function scenario(...args: Parameters<typeof bridge>) {
  const app = await bridge(...args);
  onTestFinished(async () => {
    await app.close();
    vi.unstubAllGlobals();
  });
  return app;
}

export async function mentioned(...args: Parameters<typeof bridge>) {
  const app = await scenario(...args);
  await app.mention(message());
  await vi.waitFor(() => expect(app.opencode.prompts.size).toBe(1));
  return app;
}
