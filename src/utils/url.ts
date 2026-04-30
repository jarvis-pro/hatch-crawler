import { createHash } from "node:crypto";

/** Stable fingerprint for a URL — used for dedup and incremental crawl. */
export function urlFingerprint(url: string): string {
  // Normalize: strip fragment, sort query params
  try {
    const u = new URL(url);
    u.hash = "";
    u.searchParams.sort();
    return createHash("sha1").update(u.toString()).digest("hex");
  } catch {
    return createHash("sha1").update(url).digest("hex");
  }
}

export function getHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** Resolve a possibly relative URL against a base URL. */
export function resolveUrl(base: string, href: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}
