/**
 * User-Agent pool. We rotate through a small set of realistic browser UAs.
 * Add more to taste — keep them up to date with current browser versions.
 */
const USER_AGENTS = [
  // Chrome on macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  // Chrome on Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  // Safari on macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  // Firefox on Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
  // Edge on Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
];

export class UAPool {
  private idx = 0;
  constructor(private readonly pool: readonly string[] = USER_AGENTS) {}

  next(): string {
    const ua = this.pool[this.idx % this.pool.length]!;
    this.idx += 1;
    return ua;
  }

  random(): string {
    const i = Math.floor(Math.random() * this.pool.length);
    return this.pool[i]!;
  }
}
