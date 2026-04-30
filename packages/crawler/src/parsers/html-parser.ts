import * as cheerio from "cheerio";
import { resolveUrl } from "../utils/url.js";

export type Cheerio = cheerio.CheerioAPI;

export function loadHtml(html: string): Cheerio {
  return cheerio.load(html);
}

/** Extract every absolute href on the page, resolved against `baseUrl`. */
export function extractLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const out = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    if (href.startsWith("javascript:") || href.startsWith("mailto:")) return;
    const abs = resolveUrl(baseUrl, href);
    if (abs) out.add(abs);
  });
  return [...out];
}

/** Extract page metadata (title, description, OG tags). */
export function extractMeta(html: string): {
  title: string;
  description: string;
  og: Record<string, string>;
} {
  const $ = cheerio.load(html);
  const og: Record<string, string> = {};
  $('meta[property^="og:"]').each((_, el) => {
    const k = $(el).attr("property");
    const v = $(el).attr("content");
    if (k && v) og[k] = v;
  });
  return {
    title: $("title").first().text().trim(),
    description: $('meta[name="description"]').attr("content")?.trim() ?? "",
    og,
  };
}
