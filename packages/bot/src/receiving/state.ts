import { MemoryStateAdapter } from "@chat-adapter/state-memory";
import { Schema } from "effect";

export class ReceivingState extends MemoryStateAdapter {
  private readonly expires = new Map<string, number>();

  // oxlint-disable-next-line typescript/no-restricted-types -- trust boundary: Chat SDK deduplication values are validated before entering the cache
  override async setIfNotExists(key: string, value: unknown, ttlMs = 60_000) {
    const marker = Schema.decodeUnknownSync(Schema.Boolean)(value);
    const now = Date.now();
    // ponytail: scan the current TTL window; use an expiry heap if receive throughput makes this measurable.
    for (const [entry, expiry] of this.expires) {
      if (expiry > now) break;
      this.expires.delete(entry);
      await this.delete(entry);
    }
    const inserted = await super.setIfNotExists(key, marker, ttlMs);
    if (inserted) this.expires.set(key, now + ttlMs);
    return inserted;
  }
}
