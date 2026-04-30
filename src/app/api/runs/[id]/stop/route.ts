import "server-only";
import { getDb, runRepo } from "@/lib/db";
import { env } from "@/lib/env";
import { fail, failInternal, ok } from "@/lib/api/response";
import { abortRun } from "@/lib/worker/index";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(_req: Request, { params }: Ctx): Promise<Response> {
  try {
    const { id } = await params;
    const db = getDb(env.databaseUrl);
    const run = await runRepo.getById(db, id);
    if (!run) return fail("NOT_FOUND", `run not found: ${id}`);
    if (run.status !== "running") {
      return fail("CONFLICT", `run is not running (status: ${run.status})`);
    }
    abortRun(id);
    // worker 收到 abort 后会自己 markFinished('stopped')，
    // 这里也提前更新 status 让前端立即看到状态
    await runRepo.markFinished(db, id, "stopped");
    return ok({ id });
  } catch (err) {
    return failInternal(err);
  }
}
