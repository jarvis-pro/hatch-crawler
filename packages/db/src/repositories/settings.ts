import { eq } from "drizzle-orm";
import type { Db } from "../client.js";
import { settings, type Setting } from "../schema.js";

export async function get<T = unknown>(
  db: Db,
  key: string,
): Promise<T | null> {
  const rows = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  return (rows[0]?.value as T | undefined) ?? null;
}

export async function set(
  db: Db,
  key: string,
  value: unknown,
): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value: value as Setting["value"] })
    .onConflictDoUpdate({
      target: settings.key,
      set: {
        value: value as Setting["value"],
        updatedAt: new Date(),
      },
    });
}

export async function listAll(db: Db): Promise<Setting[]> {
  return db.select().from(settings);
}

export async function remove(db: Db, key: string): Promise<void> {
  await db.delete(settings).where(eq(settings.key, key));
}
