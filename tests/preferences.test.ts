import { describe, expect, it } from "vitest";
import {
  decodeHistoryFilters,
  decodeStockFilters,
  historyDates,
  normalizeHistoryFilters,
  normalizeStockFilters,
} from "../web/preferences";
import type { Product } from "../src/core/types";

const now = Date.parse("2026-10-10T16:05:00Z"); // October 11 in Hong Kong.
const product = (model: string, color: string, capacity: string): Product => ({
  id: `${model}-${color}-${capacity}`,
  model,
  color,
  capacity,
  url: "https://www.apple.com/hk/shop/buy-iphone",
  active: true,
});

describe("saved page filters", () => {
  it("recovers malformed preferences without losing valid individual fields", () => {
    expect(decodeStockFilters(null)).toEqual({
      model: "iPhone 18 Pro",
      color: "burgundy",
      capacity: "256GB",
    });
    expect(
      decodeStockFilters({ model: [], color: "black", capacity: 512 }),
    ).toEqual({
      model: "iPhone 18 Pro",
      color: "black",
      capacity: "256GB",
    });
    const filters = decodeHistoryFilters(
      { color: "silver", minutes: 25, days: 100 },
      now,
    );
    expect(filters).toMatchObject({ color: "silver", minutes: 15, days: 7 });
    expect(historyDates(filters, now)).toEqual({
      from: "2026-10-05",
      to: "2026-10-11",
    });
  });

  it("rebases saved relative ranges across Hong Kong midnight and retains custom dates", () => {
    const filters = decodeHistoryFilters(
      { days: 7, from: "2026-10-04", to: "2026-10-10" },
      now,
    );
    expect(historyDates(filters, now)).toEqual({
      from: "2026-10-05",
      to: "2026-10-11",
    });
    expect(historyDates({ ...filters, days: 1 }, now)).toEqual({
      from: "2026-10-11",
      to: "2026-10-11",
    });
    expect(historyDates({ ...filters, days: 30 }, now)).toEqual({
      from: "2026-09-12",
      to: "2026-10-11",
    });
    const custom = decodeHistoryFilters(
      { days: 0, from: "2026-09-01", to: "2026-09-30", minutes: 60 },
      now,
    );
    expect(historyDates(custom, now + 86400000)).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(custom.minutes).toBe(60);
  });

  it("rejects invalid, future, reversed and oversized saved date ranges", () => {
    for (const [from, to] of [
      ["2026-02-30", "2026-03-01"],
      ["2026-10-10", "2026-10-12"],
      ["2026-10-11", "2026-10-10"],
      ["2024-01-01", "2026-10-10"],
      ["", "2026-10-10"],
    ]) {
      expect(
        decodeHistoryFilters(
          { days: 0, from, to, model: "iPhone 18 Pro Max" },
          now,
        ),
      ).toMatchObject({ days: 7, model: "iPhone 18 Pro Max" });
    }
  });

  it("waits for the catalog and repairs unavailable stock combinations", () => {
    const saved = {
      model: "iPhone 18 Pro Max",
      color: "black",
      capacity: "2TB",
    };
    expect(normalizeStockFilters(saved, [])).toBe(saved);
    const products = [
      product(saved.model, "black", "512GB"),
      product(saved.model, "black", "1TB"),
      { ...product(saved.model, "black", "2TB"), active: false },
    ];
    expect(normalizeStockFilters(saved, products)).toEqual({
      ...saved,
      capacity: "512GB",
    });
    const available = { ...saved, capacity: "1TB" };
    expect(normalizeStockFilters(available, products)).toBe(available);
    expect(
      normalizeStockFilters(saved, [
        product("iPhone 18 Pro", "burgundy", "256GB"),
      ]),
    ).toEqual(decodeStockFilters(null));
  });

  it("preserves historical inactive products and clears only removed filter options", () => {
    const saved = decodeHistoryFilters(
      {
        model: "iPhone 18 Pro Max",
        color: "black",
        capacity: "2TB",
        storeId: "R409",
      },
      now,
    );
    expect(normalizeHistoryFilters(saved, [], [])).toBe(saved);
    const products = [
      { ...product(saved.model, "black", "2TB"), active: false },
    ];
    expect(
      normalizeHistoryFilters(saved, products, [
        { id: "R409", name: "ifc mall" },
      ]),
    ).toBe(saved);
    expect(
      normalizeHistoryFilters(saved, products, [
        { id: "R428", name: "Canton Road" },
      ]),
    ).toEqual({ ...saved, storeId: "" });
    expect(
      normalizeHistoryFilters({ ...saved, color: "removed" }, products, []),
    ).toEqual({ ...saved, color: "" });
  });
});
