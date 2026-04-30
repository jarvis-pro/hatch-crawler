import * as cheerio from "cheerio";

/**
 * Next.js page-data extraction.
 *
 * Why this is the killer feature for Next.js sites:
 *  1. Most Next.js pages embed full server-rendered props as JSON inside
 *     <script id="__NEXT_DATA__">. That's typed, structured data — much
 *     more reliable than HTML scraping.
 *  2. SSG/ISR pages also expose `_next/data/{buildId}/{path}.json`. Once
 *     you discover the buildId, you can hit the JSON API directly and
 *     skip HTML rendering entirely.
 */

export interface NextData {
  props: { pageProps?: Record<string, unknown> } & Record<string, unknown>;
  page: string;
  query: Record<string, unknown>;
  buildId: string;
  isFallback?: boolean;
  gssp?: boolean;
  gsp?: boolean;
  [k: string]: unknown;
}

/** Extract the parsed __NEXT_DATA__ JSON from a Next.js HTML response. */
export function extractNextData(html: string): NextData | null {
  const $ = cheerio.load(html);
  const raw = $("script#__NEXT_DATA__").first().contents().text();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as NextData;
  } catch {
    return null;
  }
}

/**
 * Build the JSON-data URL for a Next.js page.
 *
 *   https://example.com/foo/bar  →
 *   https://example.com/_next/data/{buildId}/foo/bar.json
 *
 * For the home page, "/" maps to "/index.json".
 */
export function buildNextDataUrl(pageUrl: string, buildId: string): string {
  const u = new URL(pageUrl);
  let path = u.pathname.replace(/\/+$/, "");
  if (path === "") path = "/index";
  u.pathname = `/_next/data/${buildId}${path}.json`;
  return u.toString();
}
