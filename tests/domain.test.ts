import { describe, it, expect } from "vitest";
import { transition, aggregate, retryDelay } from "../src/core/domain";

const previous = { status: "unavailable" as const, checkedAt: 100_000 };
describe("observations", () => {
  it("counts only confirmed unavailable -> available as restock", () => {
    expect(transition(previous, "available", 130_000)).toEqual({
      kind: "restock",
      notify: true,
    });
    expect(transition(undefined, "available", 130_000)).toEqual({
      kind: "initial",
      notify: true,
    });
    expect(
      transition({ ...previous, status: "available" }, "available", 130_000),
    ).toEqual({ notify: false });
  });
  it("separates recovery after 90s and never treats unknown as sold out", () => {
    expect(transition(previous, "available", 190_001)).toEqual({
      kind: "recovery",
      notify: true,
    });
    expect(transition(previous, "unknown", 130_000)).toEqual({ notify: false });
    expect(
      transition({ ...previous, status: "available" }, "available", 190_001),
    ).toEqual({ kind: "recovery", notify: false });
  });
  it("backs off exponentially, respects retry-after and caps ordinary failures", () => {
    expect(retryDelay(1)).toBe(30_000);
    expect(retryDelay(8)).toBe(300_000);
    expect(retryDelay(2, 420_000)).toBe(420_000);
  });
});
describe("history", () => {
  const midnight = Date.parse("2026-10-09T16:00:00Z");
  it("splits interval exposure across HK midnight and counts separate stores", () => {
    const result = aggregate({
      from: midnight - 900_000,
      to: midnight + 900_000,
      minutes: 15,
      pairCount: 2,
      intervals: [
        {
          start: midnight - 600_000,
          end: midnight + 600_000,
          status: "available",
          storeId: "A",
          productId: "P",
        },
      ],
      events: [
        { at: midnight + 1, kind: "restock", storeId: "A", productId: "P" },
        { at: midnight + 2, kind: "restock", storeId: "B", productId: "P" },
        { at: midnight + 3, kind: "initial", storeId: "A", productId: "P" },
      ],
    });
    expect(result.buckets.map((b) => b.date)).toEqual([
      "2026-10-09",
      "2026-10-10",
    ]);
    expect(result.buckets[1].restocks).toBe(2);
    expect(result.buckets[1].initial).toBe(1);
    expect(result.buckets[1].exposureSeconds).toBe(600);
    expect(result.buckets[1].coverageRatio).toBeCloseTo(1 / 3);
    expect(result.buckets[1].rate).toBe(12);
    expect(result.stores.find((s) => s.storeId === "A")?.availableSeconds).toBe(
      1200,
    );
  });
  it("keeps no-coverage bins blank instead of reporting zero stock", () => {
    const r = aggregate({
      from: midnight,
      to: midnight + 3_600_000,
      minutes: 60,
      pairCount: 1,
      intervals: [],
      events: [],
    });
    expect(r.buckets[0].rate).toBeNull();
    expect(r.buckets[0].coverageRatio).toBe(0);
  });
});
it("wakes for notification retries independently from inventory backoff", async () => {
  const { nextWakeAt } = await import("../src/core/domain");
  expect(nextWakeAt({ enabled: true, nextAt: 301000 }, 31000, 1000)).toBe(
    31000,
  );
  expect(nextWakeAt({ enabled: false, nextAt: 301000 }, 2000, 1000)).toBe(2000);
  expect(nextWakeAt({ enabled: true, nextAt: 1000 }, null, 1000)).toBe(30000);
});
