/**
 * Per-host token-bucket-ish rate limiter.
 *
 * For each host, ensure a minimum interval between two outgoing requests.
 * This is the polite-crawler basic: it spaces out hits so we don't look
 * like a hammer to any single origin.
 */
export class HostRateLimiter {
  private readonly nextAllowed = new Map<string, number>();

  constructor(private readonly intervalMs: number) {}

  /** Resolves when it's safe to send the next request to `host`. */
  async acquire(host: string): Promise<void> {
    const now = Date.now();
    const allowed = this.nextAllowed.get(host) ?? 0;
    const wait = Math.max(0, allowed - now);

    // Reserve the next slot now so concurrent callers queue correctly.
    this.nextAllowed.set(host, Math.max(now, allowed) + this.intervalMs);

    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}
