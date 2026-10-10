import { useEffect, useState } from "react";
import { hkDate, hkMidnight } from "../src/core/domain";
import type { Product, Store } from "../src/core/types";

export interface StockFilters {
  model: string;
  color: string;
  capacity: string;
}
export interface HistoryFilters extends StockFilters {
  storeId: string;
  days: 0 | 1 | 7 | 30;
  from: string;
  to: string;
  minutes: 15 | 60;
}

const stockDefaults: StockFilters = {
  model: "iPhone 18 Pro",
  color: "burgundy",
  capacity: "256GB",
};
const dayMs = 86400000;
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
const text = (value: unknown, fallback = "") =>
  typeof value === "string" && value.length <= 100 && value.trim()
    ? value.trim()
    : fallback;

export function decodeStockFilters(value: unknown): StockFilters {
  const saved = record(value);
  return {
    model: text(saved.model, stockDefaults.model),
    color: text(saved.color, stockDefaults.color),
    capacity: text(saved.capacity, stockDefaults.capacity),
  };
}

export function historyDates(
  filters: Pick<HistoryFilters, "days" | "from" | "to">,
  now = Date.now(),
) {
  return filters.days
    ? { from: hkDate(now - (filters.days - 1) * dayMs), to: hkDate(now) }
    : { from: filters.from, to: filters.to };
}

function validDate(date: string) {
  const at = hkMidnight(date);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(at) &&
    hkDate(at) === date
  );
}

export function decodeHistoryFilters(
  value: unknown,
  now = Date.now(),
): HistoryFilters {
  const saved = record(value);
  let days: HistoryFilters["days"] =
    saved.days === 0 || saved.days === 1 || saved.days === 30 ? saved.days : 7;
  let from = text(saved.from),
    to = text(saved.to);
  if (
    days === 0 &&
    (!validDate(from) ||
      !validDate(to) ||
      from > to ||
      to > hkDate(now) ||
      hkMidnight(to) - hkMidnight(from) > 365 * dayMs)
  ) {
    days = 7;
  }
  ({ from, to } = historyDates({ days, from, to }, now));
  return {
    model: text(saved.model),
    color: text(saved.color),
    capacity: text(saved.capacity),
    storeId: text(saved.storeId),
    days,
    from,
    to,
    minutes: saved.minutes === 60 ? 60 : 15,
  };
}

export function normalizeStockFilters(
  filters: StockFilters,
  products: Product[],
): StockFilters {
  const active = products.filter((p) => p.active);
  // An empty catalog may still be loading. Keep the saved choice until it arrives.
  if (!active.length) return filters;
  const model = active.some((p) => p.model === filters.model)
    ? filters.model
    : (active.find((p) => p.model === stockDefaults.model)?.model ??
      active[0].model);
  const models = active.filter((p) => p.model === model);
  const color = models.some((p) => p.color === filters.color)
    ? filters.color
    : (models.find((p) => p.color === stockDefaults.color)?.color ??
      models[0].color);
  const choices = models
    .filter((p) => p.color === color)
    .sort(
      (a, b) =>
        parseInt(a.capacity) * (a.capacity.includes("TB") ? 1024 : 1) -
        parseInt(b.capacity) * (b.capacity.includes("TB") ? 1024 : 1),
    );
  const capacity = choices.some((p) => p.capacity === filters.capacity)
    ? filters.capacity
    : choices[0].capacity;
  return model === filters.model &&
    color === filters.color &&
    capacity === filters.capacity
    ? filters
    : { model, color, capacity };
}

export function normalizeHistoryFilters(
  filters: HistoryFilters,
  products: Product[],
  stores: Store[],
): HistoryFilters {
  const normalized = { ...filters };
  for (const field of ["model", "color", "capacity"] as const) {
    if (
      products.length &&
      filters[field] &&
      !products.some((p) => p[field] === filters[field])
    )
      normalized[field] = "";
  }
  if (
    stores.length &&
    filters.storeId &&
    !stores.some((s) => s.id === filters.storeId)
  )
    normalized.storeId = "";
  return normalized.model === filters.model &&
    normalized.color === filters.color &&
    normalized.capacity === filters.capacity &&
    normalized.storeId === filters.storeId
    ? filters
    : normalized;
}

export function useLocalFilters<T>(
  page: "stock" | "history",
  decode: (value: unknown) => T,
) {
  const key = `iphone-ding.${page}-filters.v1`;
  const [filters, setFilters] = useState<T>(() => {
    try {
      return decode(JSON.parse(window.localStorage.getItem(key) ?? "null"));
    } catch {
      return decode(null);
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(filters));
    } catch {
      // Storage may be disabled or full; the page still works for this session.
    }
  }, [key, filters]);
  return [filters, setFilters] as const;
}
