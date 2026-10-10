import { Repository } from "../db/repository";
import type { SqlDriver } from "../db/driver";
export function cloudflareRepository(db: D1Database) {
  const prepare = (sql: string, params: unknown[]) =>
    db.prepare(sql).bind(...params);
  const driver: SqlDriver = {
    rows: async (q) => prepare(q.sql, q.params).raw(),
    objects: async (q) => (await prepare(q.sql, q.params).all()).results,
    run: async (q) => (await prepare(q.sql, q.params).run()).meta.changes,
    batch: async (qs) => {
      if (qs.length) await db.batch(qs.map((q) => prepare(q.sql, q.params)));
    },
  };
  return new Repository(driver);
}
