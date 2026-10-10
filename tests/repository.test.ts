import { beforeEach, afterEach, it, expect } from "vitest";
import { nodeRepository } from "../src/adapters/node-db";
let repo: ReturnType<typeof nodeRepository>;
beforeEach(async () => {
  repo = nodeRepository(":memory:");
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
});
afterEach(() => repo.close());
const sample = { productId: "P", storeId: "S", status: "available" as const };
it("persists deduplicated rounds and restart-safe state with atomic events", async () => {
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
  expect(await repo.acquire("r1", 1000)).toBe(true);
  expect(await repo.acquire("r2", 1001)).toBe(false);
  await repo.commitRound("r1", [sample], 1000, []);
  expect((await repo.events({ from: 0, to: 100_000 })).items).toHaveLength(1);
  expect(await repo.acquire("r1", 2000)).toBe(false);
  expect(await repo.acquire("r2", 31_000)).toBe(true);
  await repo.commitRound("r2", [sample], 31_000, []);
  expect((await repo.events({ from: 0, to: 100_000 })).items).toHaveLength(1);
  expect(
    (await repo.historyData({ from: 0, to: 100_000 })).intervals[0],
  ).toMatchObject({ start: 1000, end: 31000, status: "available" });
});
it("counts every availability result including unchanged stock, excludes duplicates and separates unknown", async () => {
  for (const [id, at, status] of [
    ["count-a", 1000, "available"],
    ["count-b", 31000, "available"],
    ["count-c", 61000, "unknown"],
    ["count-d", 91000, "unavailable"],
  ] as const) {
    await repo.acquire(id, at);
    await repo.commitRound(id, [{ ...sample, status }], at, []);
  }
  await expect(
    repo.commitRound("count-d", [sample], 92000, []),
  ).rejects.toThrow();
  const data = await repo.queryCounts({ from: 0, to: 200000 });
  expect(data.total).toBe(1);
  expect(data.items[0]).toMatchObject({
    at: 0,
    available: 2,
    unavailable: 1,
    unknown: 1,
    lastAt: 91000,
  });
  expect(await repo.setting("queryCountsStartedAt")).toBe("1000");
  expect(
    (await repo.queryCounts({ from: 0, to: 200000, color: "burgundy" })).total,
  ).toBe(0);
});
it("does not count unknown or observation gaps as restocks", async () => {
  for (const [id, at, status] of [
    ["a", 1000, "unavailable"],
    ["b", 31000, "unknown"],
    ["c", 62000, "available"],
    ["d", 180000, "available"],
  ] as const) {
    await repo.acquire(id, at);
    await repo.commitRound(id, [{ ...sample, status }], at, []);
  }
  const events = (await repo.events({ from: 0, to: 200000 })).items;
  expect(events.map((e) => e.kind)).toEqual(["recovery", "restock"]);
});
it("validates and persists watch updates without stopping collection", async () => {
  await repo.saveWatch({
    id: "w",
    name: "目标",
    productIds: ["P"],
    storeIds: ["S"],
    enabled: true,
  });
  await repo.saveWatch({
    id: "w",
    name: "目标",
    productIds: ["P"],
    storeIds: ["S"],
    enabled: false,
  });
  expect((await repo.watches())[0].enabled).toBe(false);
});
it("queues current fresh stock when a watch is first enabled without repeating on rename", async () => {
  await repo.acquire("a", 1000);
  await repo.commitRound("a", [sample], 1000, []);
  const w = {
    id: "w",
    name: "mine",
    productIds: ["P"],
    storeIds: ["S"],
    enabled: true,
  };
  await repo.saveWatch(w, 2000);
  expect(await repo.pending(2000)).toHaveLength(1);
  await repo.saveWatch({ ...w, name: "renamed" }, 3000);
  expect(await repo.pending(3000)).toHaveLength(1);
  await repo.saveWatch({ ...w, enabled: false }, 4000);
  await repo.saveWatch(w, 200000);
  expect(await repo.pending(200000)).toHaveLength(1);
});
it("rolls back a round when its lease has been superseded", async () => {
  await repo.acquire("old", 1000);
  await repo.acquire("new", 181001);
  await expect(repo.commitRound("old", [sample], 181002, [])).rejects.toThrow();
  expect(await repo.stock()).toHaveLength(0);
  expect((await repo.events({ from: 0, to: 200000 })).total).toBe(0);
  expect((await repo.queryCounts({ from: 0, to: 200000 })).total).toBe(0);
  await repo.commitRound("new", [sample], 181003, []);
  expect(await repo.stock()).toHaveLength(1);
});
it("compresses unchanged observation intervals but leaves gaps blank", async () => {
  for (const [id, at] of [
    ["a", 1000],
    ["b", 31000],
    ["c", 61000],
    ["d", 200000],
    ["e", 230000],
  ] as const) {
    await repo.acquire(id, at);
    await repo.commitRound(id, [sample], at, []);
  }
  const result = await repo.historyData({ from: 0, to: 300000 });
  expect(result.intervals).toHaveLength(2);
  expect(result.intervals.map((i) => [i.start, i.end])).toEqual([
    [1000, 61000],
    [200000, 230000],
  ]);
  expect(
    (await repo.queryCounts({ from: 0, to: 300000 })).items[0].available,
  ).toBe(5);
});
it("claims a notification once until its delivery lease expires", async () => {
  await repo.acquire("a", 1000);
  await repo.commitRound("a", [sample], 1000, [
    { title: "test", body: "stock", url: "https://www.apple.com/hk/shop/" },
  ]);
  const n = (await repo.pending(1000))[0];
  expect(await repo.claimNotification(n.id, 1000)).toBe(true);
  expect(await repo.claimNotification(n.id, 2000)).toBe(false);
  expect(await repo.pending(2000)).toHaveLength(0);
  expect(await repo.claimNotification(n.id, 61001)).toBe(true);
});
it("preserves confirmed stock and round deduplication across a real SQLite reopen", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "iphone-ding-")),
    file = join(dir, "stock.sqlite");
  let disk = nodeRepository(file);
  try {
    await disk.saveCatalog(
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
    await disk.acquire("persist", 1000);
    await disk.commitRound("persist", [sample], 1000, []);
    disk.close();
    disk = nodeRepository(file);
    expect((await disk.stock())[0].confirmed).toBe("available");
    expect(await disk.acquire("persist", 31000)).toBe(false);
    await disk.acquire("after-restart", 31000);
    await disk.commitRound("after-restart", [sample], 31000, []);
    expect((await disk.events({ from: 0, to: 100000 })).total).toBe(1);
    expect(
      (await disk.queryCounts({ from: 0, to: 100000 })).items[0].available,
    ).toBe(2);
  } finally {
    disk.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("batches a full catalog round within D1 statement and parameter limits", async () => {
  const products = Array.from({ length: 32 }, (_, i) => ({
    id: `P${i}`,
    model: "iPhone 18 Pro",
    color: "black",
    capacity: "256GB",
    url: "https://www.apple.com/hk/shop/",
    active: true,
  }));
  const stores = Array.from({ length: 6 }, (_, i) => ({
    id: `S${i}`,
    name: `Store ${i}`,
  }));
  await repo.saveCatalog(products, stores, 1000);
  const observations = products.flatMap((p) =>
    stores.map((s) => ({
      productId: p.id,
      storeId: s.id,
      status: "available" as const,
    })),
  );
  await repo.acquire("full", 1000);
  const original = repo.driver.batch.bind(repo.driver);
  let size = 0;
  repo.driver.batch = async (commands) => {
    size = commands.length;
    expect(commands.every((q) => q.params.length <= 100)).toBe(true);
    await original(commands);
  };
  await repo.commitRound("full", observations, 1000, []);
  expect(size).toBeLessThanOrEqual(45);
  expect((await repo.stock()).length).toBe(192);
});
