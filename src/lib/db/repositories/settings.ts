import type { Prisma } from '@prisma/client';
import type { Db } from '../client';
import type { Setting } from '../index';

export async function get<T = unknown>(db: Db, key: string): Promise<T | null> {
  const row = await db.setting.findUnique({ where: { key } });
  return (row?.value as T | undefined) ?? null;
}

export async function set(db: Db, key: string, value: unknown): Promise<void> {
  await db.setting.upsert({
    where: { key },
    create: { key, value: value as Prisma.InputJsonValue },
    update: { value: value as Prisma.InputJsonValue, updatedAt: new Date() },
  });
}

export async function listAll(db: Db): Promise<Setting[]> {
  return db.setting.findMany();
}

export async function remove(db: Db, key: string): Promise<void> {
  await db.setting.delete({ where: { key } });
}
