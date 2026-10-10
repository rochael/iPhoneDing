import "../src/adapters/load-env";
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { z } from "zod";
import { nodeRepository } from "../src/adapters/node-db";
import type { Statement, SqlDriver } from "../src/db/driver";
const [command, file, ...flags] = process.argv.slice(2),
  d1 = flags.includes("--d1"),
  remote = flags.includes("--remote");
const names = [
  "products",
  "stores",
  "watches",
  "states",
  "events",
  "intervals",
  "query_counts",
  "settings",
  "notifications",
  "diagnostics",
  "rounds",
] as const;
const columns: Record<(typeof names)[number], string[]> = {
  products: ["id", "model", "color", "capacity", "url", "active"],
  stores: ["id", "name"],
  watches: ["id", "name", "productIds", "storeIds", "enabled"],
  states: [
    "id",
    "product_id",
    "store_id",
    "status",
    "confirmed",
    "checked_at",
    "attempted_at",
    "segment_id",
  ],
  events: ["id", "product_id", "store_id", "at", "kind"],
  intervals: ["id", "product_id", "store_id", "start", "end", "status"],
  query_counts: [
    "id",
    "product_id",
    "store_id",
    "at",
    "available",
    "unavailable",
    "unknown",
    "last_at",
  ],
  settings: ["key", "value"],
  notifications: [
    "id",
    "created_at",
    "attempts",
    "next_at",
    "status",
    "message",
  ],
  diagnostics: ["id", "at", "message"],
  rounds: ["id", "at", "status"],
};
const sqlite = d1 ? null : nodeRepository();
function literal(value: unknown) {
  if (value === null) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
  throw Error("备份含不支持的 SQL 值");
}
function executeD1(statements: Statement[]) {
  const text = statements
    .map((q) => {
      let i = 0;
      return q.sql.replace(/\?/g, () => literal(q.params[i++]));
    })
    .join(";\n");
  const result = spawnSync(
    "npx",
    [
      "--no-install",
      "wrangler",
      "d1",
      "execute",
      "iphone-ding",
      remote ? "--remote" : "--local",
      "--command",
      text,
      "--json",
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0)
    throw Error(
      "D1 执行失败。检查登录、数据库 ID 或参数；导入标记保留以防采集不完整数据。",
    );
  const rows = JSON.parse(result.stdout) as {
    results: Record<string, unknown>[];
    meta: { changes: number };
  }[];
  return rows;
}
const driver: SqlDriver = sqlite?.driver ?? {
  objects: async (q) => executeD1([q])[0]?.results ?? [],
  rows: async (q) => (executeD1([q])[0]?.results ?? []).map(Object.values),
  run: async (q) => executeD1([q])[0]?.meta.changes ?? 0,
  batch: async (qs) => {
    executeD1(qs);
  },
};
function chmodSyncSafe(path: string) {
  try {
    chmodSync(path, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
try {
  if (!["export", "import", "stop"].includes(command))
    throw Error(
      "用法：npm run data -- export|import backup.json [--d1] [--remote]；或 stop [占位文件名] [--d1] [--remote]",
    );
  if (command === "stop") {
    await driver.batch([
      {
        sql: "INSERT INTO settings(key,value) VALUES ('monitorEnabled','false') ON CONFLICT(key) DO UPDATE SET value='false'",
        params: [],
      },
      {
        sql: "INSERT INTO settings(key,value) VALUES ('maintenanceMode','true') ON CONFLICT(key) DO UPDATE SET value='true'",
        params: [],
      },
    ]);
    console.log("采集已标记暂停。等当前轮次结束后再执行导出或导入。");
  } else {
    if (!file) throw Error("需要备份文件路径");
    const enabled = (
      await driver.objects({
        sql: "SELECT value FROM settings WHERE key='monitorEnabled'",
        params: [],
      })
    )[0]?.value;
    if (enabled !== "false")
      throw Error("请先在设置页暂停全部采集，再执行备份或迁移");
    await driver.run({
      sql: "INSERT INTO settings(key,value) VALUES ('maintenanceMode','true') ON CONFLICT(key) DO UPDATE SET value='true'",
      params: [],
    });
    const sending = (
      await driver.objects({
        sql: "SELECT COUNT(*) AS total FROM notifications WHERE status='sending' AND next_at>?",
        params: [Date.now()],
      })
    )[0];
    const lock = (
      await driver.objects({
        sql: "SELECT expires FROM locks WHERE id='monitor'",
        params: [],
      })
    )[0];
    if (
      enabled !== "false" ||
      Number(lock?.expires ?? 0) > Date.now() ||
      Number(sending?.total ?? 0) > 0
    )
      throw Error(
        "先在设置页暂停采集，并等待当前轮次结束；源与目标都应停止监控。",
      );
    if (command === "export") {
      const tables: Record<string, Record<string, unknown>[]> = {};
      for (const name of names) {
        const rows: Record<string, unknown>[] = [];
        for (let offset = 0; ; offset += 1000) {
          const part = await driver.objects({
            sql: `SELECT * FROM ${name} ORDER BY ${name === "settings" ? "key" : "id"} LIMIT 1000 OFFSET ?`,
            params: [offset],
          });
          rows.push(...part);
          if (part.length < 1000) break;
        }
        tables[name] = rows;
      }
      chmodSyncSafe(file);
      writeFileSync(
        file,
        JSON.stringify({ version: 2, exportedAt: Date.now(), tables }),
        { mode: 0o600 },
      );
      chmodSync(file, 0o600);
      console.log("备份已导出。文件包含 Bark 设备密钥，请妥善保存。");
    } else {
      const backup = z
        .object({
          version: z.union([z.literal(1), z.literal(2)]),
          tables: z.record(
            z.string(),
            z.array(
              z.record(
                z.string(),
                z.union([z.string(), z.number().finite(), z.null()]),
              ),
            ),
          ),
        })
        .parse(JSON.parse(readFileSync(file, "utf8")));
      if (backup.version === 1) {
        backup.tables.query_counts = [];
        if (backup.tables.settings)
          backup.tables.settings = backup.tables.settings.filter(
            (s) => s.key !== "queryCountsStartedAt",
          );
      }
      for (const name of names) {
        if (!backup.tables[name]) throw Error(`缺少表 ${name}`);
        for (const row of backup.tables[name])
          if (
            Object.keys(row).length !== columns[name].length ||
            columns[name].some((c) => !(c in row))
          )
            throw Error(`表 ${name} 的列不匹配`);
      }
      await driver.run({
        sql: "INSERT INTO settings(key,value) VALUES ('importInProgress','true') ON CONFLICT(key) DO UPDATE SET value='true'",
        params: [],
      });
      for (const name of names) {
        await driver.run({
          sql:
            name === "settings"
              ? "DELETE FROM settings WHERE key NOT IN ('importInProgress','monitorEnabled','maintenanceMode')"
              : `DELETE FROM ${name}`,
          params: [],
        });
        const rows = backup.tables[name].filter(
          (row) =>
            name !== "settings" ||
            !["importInProgress", "monitorEnabled", "maintenanceMode"].includes(
              String(row.key),
            ),
        );
        for (let i = 0; i < rows.length; i += 50)
          await driver.batch(
            rows.slice(i, i + 50).map((row) => ({
              sql: `INSERT INTO ${name} (${columns[name].map((c) => `"${c}"`).join(",")}) VALUES (${columns[name].map(() => "?").join(",")})`,
              params: columns[name].map((c) => row[c]),
            })),
          );
      }
      await driver.batch([
        {
          sql: "UPDATE settings SET value='false' WHERE key='monitorEnabled'",
          params: [],
        },
        {
          sql: "DELETE FROM settings WHERE key='importInProgress'",
          params: [],
        },
      ]);
      console.log("数据已导入，目标仍暂停。核对统计与推送设置后再恢复采集。");
    }
  }
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  sqlite?.close();
}
