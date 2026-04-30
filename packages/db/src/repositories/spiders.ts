import { eq } from "drizzle-orm";
import type { Db } from "../client.js";
import { spiders, type NewSpider, type Spider } from "../schema.js";

export function listAll(db: Db): Promise<Spider[]> {
  return db.select().from(spiders).orderBy(spiders.name);
}

export async function getByName(
  db: Db,
  name: string,
): Promise<Spider | null> {
  const rows = await db
    .select()
    .from(spiders)
    .where(eq(spiders.name, name))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsert(db: Db, input: NewSpider): Promise<Spider> {
  const [row] = await db
    .insert(spiders)
    .values(input)
    .onConflictDoUpdate({
      target: spiders.name,
      set: {
        displayName: input.displayName,
        description: input.description ?? null,
        startUrls: input.startUrls,
        allowedHosts: input.allowedHosts ?? [],
        maxDepth: input.maxDepth ?? 2,
        concurrency: input.concurrency ?? 4,
        perHostIntervalMs: input.perHostIntervalMs ?? 500,
        enabled: input.enabled ?? true,
        cronSchedule: input.cronSchedule ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row!;
}

export async function remove(db: Db, name: string): Promise<void> {
  await db.delete(spiders).where(eq(spiders.name, name));
}
