import "server-only";
import { BaseSpider, NextJsBlogSpider } from "@hatch-crawler/crawler";

/**
 * Spider 注册表：name → 工厂函数。
 *
 * v1 是硬编码的——加新 Spider 需要重启 web 进程。
 * 未来要做"插件式"，可以扫一个 spiders/ 目录动态加载。
 */

type SpiderFactory = () => BaseSpider;

export const SPIDER_REGISTRY: Record<string, SpiderFactory> = {
  "nextjs-blog": () => new NextJsBlogSpider(),
};

export function getSpiderFactory(name: string): SpiderFactory | null {
  return SPIDER_REGISTRY[name] ?? null;
}

export function listSpiderNames(): string[] {
  return Object.keys(SPIDER_REGISTRY);
}
