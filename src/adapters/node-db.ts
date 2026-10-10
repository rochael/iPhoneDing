import Database from "better-sqlite3";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Repository } from "../db/repository";
import type { SqlDriver, Statement } from "../db/driver";
export function nodeRepository(
  path = process.env.DATABASE_PATH ?? "data/iphone-ding.sqlite",
) {
  if (path !== ":memory:")
    mkdirSync(dirname(resolve(path)), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 10000");
  for (const file of readdirSync(resolve("migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sqlite.exec(readFileSync(resolve("migrations", file), "utf8"));
  const driver: SqlDriver = {
    rows: async (q) =>
      sqlite
        .prepare(q.sql)
        .raw()
        .all(...q.params) as unknown[][],
    objects: async (q) =>
      sqlite.prepare(q.sql).all(...q.params) as Record<string, unknown>[],
    run: async (q) => sqlite.prepare(q.sql).run(...q.params).changes,
    batch: async (qs) => {
      sqlite.transaction((items: Statement[]) => {
        for (const q of items) sqlite.prepare(q.sql).run(...q.params);
      })(qs);
    },
  };
  const repo = new Repository(driver);
  return Object.assign(repo, { close: () => sqlite.close() });
}
