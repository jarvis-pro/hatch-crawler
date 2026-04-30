import { urlFingerprint } from "../utils/url.js";

export interface QueueItem {
  url: string;
  /** Spider-defined hint. e.g. "list" or "detail". */
  type?: string;
  /** Arbitrary metadata that the spider wants to carry through. */
  meta?: Record<string, unknown>;
  depth: number;
}

/**
 * URL frontier with built-in dedup.
 *
 * This in-memory implementation is enough for a learning project. To go
 * distributed, swap this for a Redis list/sorted-set backend (BullMQ, etc.)
 * — the interface is intentionally small.
 */
export class UrlQueue {
  private readonly items: QueueItem[] = [];
  private readonly seen = new Set<string>();

  get size(): number {
    return this.items.length;
  }

  get seenCount(): number {
    return this.seen.size;
  }

  /** Returns true if the URL was newly enqueued, false if it was a dup. */
  push(item: QueueItem): boolean {
    const fp = urlFingerprint(item.url);
    if (this.seen.has(fp)) return false;
    this.seen.add(fp);
    this.items.push(item);
    return true;
  }

  pop(): QueueItem | undefined {
    return this.items.shift();
  }

  /** Mark a URL as seen without enqueueing — used to seed from prior runs. */
  markSeen(url: string): void {
    this.seen.add(urlFingerprint(url));
  }
}
