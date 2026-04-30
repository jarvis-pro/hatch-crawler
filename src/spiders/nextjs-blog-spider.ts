import { BaseSpider, type SpiderContext } from "../core/spider.js";
import { extractNextData } from "../parsers/next-data-parser.js";
import { extractLinks, extractMeta, loadHtml } from "../parsers/html-parser.js";
import { resolveUrl, getHost } from "../utils/url.js";
import { logger } from "../utils/logger.js";

/**
 * Example spider for a Next.js blog/marketing site.
 *
 * Strategy:
 *   1. Fetch the seed URL (rendered HTML).
 *   2. Try to extract __NEXT_DATA__ — the structured page props.
 *      If present, use that as the source of truth.
 *   3. Otherwise fall back to <meta>/Cheerio extraction.
 *   4. Discover follow-up links on the same host.
 *
 * Replace `startUrls` with whatever Next.js site you want to crawl.
 */
export class NextJsBlogSpider extends BaseSpider {
  override readonly name = "nextjs-blog";
  override readonly maxDepth = 2;
  override readonly startUrls = [
    { url: "https://nextjs.org/blog", type: "index" },
  ];

  private readonly allowedHost = "nextjs.org";

  override async parse(ctx: SpiderContext): Promise<void> {
    const { url, response } = ctx;

    // ---- 1. Try the Next.js fast-path: __NEXT_DATA__ ----
    const nextData = extractNextData(response.body);

    // ---- 2. Extract page-level metadata as a fallback / supplement ----
    const meta = extractMeta(response.body);

    ctx.emit({
      url,
      type: ctx.type,
      payload: {
        title: meta.title,
        description: meta.description,
        og: meta.og,
        // pageProps is where Next.js puts the structured data for the page
        pageProps: nextData?.props?.pageProps ?? null,
        buildId: nextData?.buildId ?? null,
        page: nextData?.page ?? null,
      },
    });

    // ---- 3. Discover more URLs on the same host ----
    if (ctx.depth >= this.maxDepth) return;

    const $ = loadHtml(response.body);
    const links = extractLinks(response.body, response.finalUrl);

    let added = 0;
    for (const link of links) {
      if (getHost(link) !== this.allowedHost) continue;
      // For the example, only follow blog post URLs
      if (!link.includes("/blog/")) continue;
      ctx.enqueue({ url: link, type: "post" });
      added += 1;
    }

    logger.debug({ url, links: links.length, followed: added }, "parsed page");
    // Suppress unused-variable warning while keeping $ available for subclassing
    void $;
  }
}
