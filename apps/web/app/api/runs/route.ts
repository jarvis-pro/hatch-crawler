import "server-only";
import { z } from "zod";
import {
  getBoss,
  getDb,
  QUEUE_CRAWL,
  runRepo,
  spiderRepo,
  type RunStatus,
} from "@hatch-crawler/db";
import { env } from "@/lib/env";
import { fail, failInternal, failValidation, ok } from "@/lib/api/response";

const createSchema = z.object({
  spider: z.string().min(1),
  overrides: z.record(z.unknown()).default({}),
});

export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as unknown;
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return failValidation(parsed.error);

    const db = getDb(env.databaseUrl);
    const spider = await spiderRepo.getByName(db, parsed.data.spider);
    if (!spider)
      return fail("NOT_FOUND", `spider not found: ${parsed.data.spider}`);
    if (!spider.enabled)
      return fail("CONFLICT", `spider disabled: ${parsed.data.spider}`);

    const run = await runRepo.create(db, {
      spiderName: parsed.data.spider,
      triggerType: "manual",
      overrides: parsed.data.overrides,
    });

    const { boss, ready } = getBoss(env.databaseUrl);
    await ready;
    await boss.send(QUEUE_CRAWL, {
      runId: run.id,
      spider: parsed.data.spider,
      overrides: parsed.data.overrides,
    });

    return ok({ id: run.id });
  } catch (err) {
    return failInternal(err);
  }
}

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const spider = url.searchParams.get("spider") ?? undefined;
    const statusParam = url.searchParams.get("status");
    const status = statusParam
      ? (statusParam.split(",") as RunStatus[])
      : undefined;
    const page = Number(url.searchParams.get("page") ?? "1");
    const pageSize = Number(url.searchParams.get("pageSize") ?? "20");

    const db = getDb(env.databaseUrl);
    const result = await runRepo.list(db, {
      spider,
      status,
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 20,
    });
    return ok(result);
  } catch (err) {
    return failInternal(err);
  }
}
