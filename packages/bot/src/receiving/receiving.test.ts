import { createMockChatInstance, createMockLogger } from "@chat-adapter/tests";
import { expect, it, onTestFinished, vi } from "vitest";
import { ReceivingAdapter } from "./adapter.ts";
import { ReceivingState } from "./state.ts";
import { bot, message } from "../../test/discord.ts";
import type { ChatInstance } from "chat";

it("a real Chat SDK adapter never creates a thread while receiving a Mention", async () => {
  const network = vi.fn<(...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>>(() => {
    throw new Error("Receiving must not call the Discord REST API");
  });
  vi.stubGlobal("fetch", network);
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
  const adapter = new ReceivingAdapter({
    botToken: "token",
    applicationId: bot.id,
    publicKey: "a".repeat(64),
    logger: createMockLogger(),
    mentionRoleIds: [],
    respondToChannelIds: [],
    respondToGlobalMentions: false,
    apiUrl: "http://discord.test",
  });
  const incoming = vi.fn<ChatInstance["handleIncomingMessage"]>();
  const chat = createMockChatInstance({ overrides: { handleIncomingMessage: incoming } });
  await adapter.initialize(chat);
  const result = await adapter.handleWebhook(
    new Request("http://bridge/gateway", {
      method: "POST",
      headers: { "x-discord-gateway-token": "token" },
      body: JSON.stringify({ type: "GATEWAY_MESSAGE_CREATE", data: message(), timestamp: 0 }),
    }),
  );
  expect(result.status).toBe(200);
  expect(incoming).toHaveBeenCalledOnce();
  expect(network).not.toHaveBeenCalled();
});

it("deduplication entries expire and are reclaimed as new Mentions arrive", async () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(0);
  onTestFinished(() => now.mockRestore());
  const state = new ReceivingState();
  await state.connect();
  expect(await state.setIfNotExists("old", true)).toBe(true);
  expect(await state.setIfNotExists("old", true)).toBe(false);
  now.mockReturnValue(60_001);
  expect(await state.setIfNotExists("new", true)).toBe(true);
  expect(await state.get("old")).toBeNull();
  expect(await state.get("new")).toBe(true);
  await state.disconnect();
});
