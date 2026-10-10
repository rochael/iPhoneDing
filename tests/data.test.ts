import { it, expect } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  statSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { nodeRepository } from "../src/adapters/node-db";
it("enforces private permissions even when overwriting an existing backup", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iphone-ding-backup-")),
    db = join(dir, "stock.sqlite"),
    file = join(dir, "backup.json"),
    repo = nodeRepository(db);
  try {
    await repo.setSetting("monitorEnabled", "false");
    await repo.setSetting("barkUrl", "https://api.day.app/test-device-key");
    writeFileSync(file, "old", { mode: 0o644 });
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/data.ts", "export", file],
      { env: { ...process.env, DATABASE_PATH: db }, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).toContain("test-device-key");
    expect(await repo.setting("maintenanceMode")).toBe("true");
  } finally {
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("round-trips exact query counts and imports old backups without inventing samples", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iphone-ding-count-backup-")),
    db = join(dir, "stock.sqlite"),
    file = join(dir, "backup.json");
  const repo = nodeRepository(db);
  const run = (command: string) =>
    spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/data.ts", command, file],
      {
        env: { ...process.env, DATABASE_PATH: db },
        encoding: "utf8",
      },
    );
  try {
    await repo.saveCatalog(
      [
        {
          id: "P",
          model: "iPhone 18 Pro",
          color: "black",
          capacity: "256GB",
          url: "https://www.apple.com/hk/shop/",
          active: true,
        },
      ],
      [{ id: "S", name: "ifc mall" }],
      1000,
    );
    for (const [id, at] of [
      ["first", 1000],
      ["second", 31000],
    ] as const) {
      await repo.acquire(id, at);
      await repo.commitRound(
        id,
        [{ productId: "P", storeId: "S", status: "available" }],
        at,
        [],
      );
    }
    await repo.setSetting("monitorEnabled", "false");
    const exported = run("export");
    expect(exported.status, exported.stderr).toBe(0);
    const backup = JSON.parse(readFileSync(file, "utf8"));
    expect(backup.version).toBe(2);
    expect(backup.tables.query_counts[0].available).toBe(2);
    await repo.driver.run({ sql: "DELETE FROM query_counts", params: [] });
    const imported = run("import");
    expect(imported.status, imported.stderr).toBe(0);
    expect(
      (await repo.queryCounts({ from: 0, to: 100000 })).items[0].available,
    ).toBe(2);
    backup.version = 1;
    delete backup.tables.query_counts;
    writeFileSync(file, JSON.stringify(backup));
    const oldImport = run("import");
    expect(oldImport.status, oldImport.stderr).toBe(0);
    expect((await repo.queryCounts({ from: 0, to: 100000 })).total).toBe(0);
    expect(await repo.setting("queryCountsStartedAt")).toBeUndefined();
    expect(await repo.stock()).toHaveLength(1);
  } finally {
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
