import "server-only";
import { z } from "zod";
import { getDb, settingRepo } from "@/lib/db";
import { env } from "@/lib/env";
import { failInternal, failValidation, ok } from "@/lib/api/response";

const putSchema = z.object({
  value: z.unknown(),
});

interface Ctx {
  params: Promise<{ key: string }>;
}

export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  try {
    const { key } = await params;
    const db = getDb(env.databaseUrl);
    const value = await settingRepo.get(db, key);
    return ok({ key, value });
  } catch (err) {
    return failInternal(err);
  }
}

export async function PUT(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const { key } = await params;
    const body = (await req.json()) as unknown;
    const parsed = putSchema.safeParse(body);
    if (!parsed.success) return failValidation(parsed.error);

    const db = getDb(env.databaseUrl);
    await settingRepo.set(db, key, parsed.data.value);
    return ok({ key });
  } catch (err) {
    return failInternal(err);
  }
}
