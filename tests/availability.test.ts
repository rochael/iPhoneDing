import { expect, it } from "vitest";
import { aggregateAvailability } from "../src/core/availability";

const from = Date.parse("2026-10-09T06:00:00+08:00");
const input = {
  from,
  to: from + 3600000,
  minutes: 60,
  pairCount: 1,
  intervals: [],
  events: [],
};
it("reports 100 available checks out of 120 valid checks, excluding failures", () => {
  const result = aggregateAvailability({
    ...input,
    queries: [
      {
        at: from,
        storeId: "S",
        available: 100,
        unavailable: 20,
        unknown: 8,
        lastAt: from + 30000,
      },
    ],
  });
  expect(result.totals).toMatchObject({
    availableChecks: 100,
    unavailableChecks: 20,
    unknownChecks: 8,
    validChecks: 120,
  });
  expect(result.totals.hitRate).toBeCloseTo(5 / 6);
  expect(result.buckets[0].hitRate).toBeCloseTo(5 / 6);
  // One valid sample already gives a hit rate even without a continuous coverage interval.
  expect(result.buckets[0].coverageRatio).toBe(0);
});
it("distinguishes measured zero availability from missing or failed-only samples", () => {
  const result = aggregateAvailability({
    ...input,
    to: from + 3 * 3600000,
    queries: [
      {
        at: from,
        storeId: "S",
        available: 0,
        unavailable: 2,
        unknown: 0,
        lastAt: from,
      },
      {
        at: from + 3600000,
        storeId: "S",
        available: 0,
        unavailable: 0,
        unknown: 3,
        lastAt: from + 3600000,
      },
    ],
  });
  expect(result.buckets.map((b) => b.hitRate)).toEqual([0, null, null]);
});
it("buckets HK midnight correctly, sums multiple stores and weights cross-day rates by sample count", () => {
  const start = Date.parse("2026-10-09T00:00:00+08:00");
  const result = aggregateAvailability({
    ...input,
    from: start,
    to: start + 2 * 86400000,
    pairCount: 2,
    queries: [
      {
        at: start,
        storeId: "S",
        available: 1,
        unavailable: 0,
        unknown: 0,
        lastAt: start,
      },
      {
        at: start,
        storeId: "T",
        available: 1,
        unavailable: 0,
        unknown: 0,
        lastAt: start,
      },
      {
        at: start + 86400000,
        storeId: "S",
        available: 8,
        unavailable: 10,
        unknown: 0,
        lastAt: start + 86400000,
      },
    ],
  });
  expect(result.buckets[0]).toMatchObject({
    date: "2026-10-09",
    time: "00:00",
    availableChecks: 2,
    validChecks: 2,
  });
  expect(result.buckets[24]).toMatchObject({
    date: "2026-10-10",
    time: "00:00",
    availableChecks: 8,
    validChecks: 18,
  });
  expect(result.ranking[0]).toMatchObject({
    time: "00:00",
    availableChecks: 10,
    validChecks: 20,
    hitRate: 0.5,
  });
  expect(result.stores.find((s) => s.storeId === "T")).toMatchObject({
    hitRate: 1,
    availableDays: 1,
  });
});
