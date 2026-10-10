import type { EventKind, Stock, StockEvent, Interval } from "./types";
export const GAP_MS = 90_000;
export function transition(
  previous:
    { status: Exclude<Stock, "unknown">; checkedAt: number } | undefined,
  status: Stock,
  at: number,
): { kind?: EventKind; notify: boolean } {
  if (status !== "available") return { notify: false };
  if (!previous) return { kind: "initial", notify: true };
  if (at - previous.checkedAt > GAP_MS)
    return { kind: "recovery", notify: previous.status !== "available" };
  return previous.status === "unavailable"
    ? { kind: "restock", notify: true }
    : { notify: false };
}
export function retryDelay(failures: number, retryAfterMs = 0) {
  return Math.max(
    Math.min(30_000 * 2 ** Math.max(0, Math.min(failures - 1, 10)), 300_000),
    retryAfterMs,
  );
}
export function hkDate(at: number) {
  return new Date(at + 8 * 3_600_000).toISOString().slice(0, 10);
}
export function hkTime(at: number) {
  return new Date(at + 8 * 3_600_000).toISOString().slice(11, 19);
}
export function hkMidnight(date: string) {
  return Date.parse(`${date}T00:00:00+08:00`);
}
export interface Bucket {
  date: string;
  time: string;
  at: number;
  restocks: number;
  initial: number;
  recovery: number;
  exposureSeconds: number;
  availableSeconds: number;
  coverageRatio: number;
  rate: number | null;
}
export function aggregate(input: {
  from: number;
  to: number;
  minutes: number;
  pairCount: number;
  intervals: Interval[];
  events: StockEvent[];
}) {
  const { from, to, minutes, pairCount, intervals, events } = input;
  const size = minutes * 60_000,
    buckets: Bucket[] = [];
  const begin =
    Math.floor((from + 8 * 3_600_000) / size) * size - 8 * 3_600_000;
  for (let at = begin; at < to; at += size)
    buckets.push({
      date: hkDate(at),
      time: hkTime(at).slice(0, 5),
      at,
      restocks: 0,
      initial: 0,
      recovery: 0,
      exposureSeconds: 0,
      availableSeconds: 0,
      coverageRatio: 0,
      rate: null,
    });
  const index = (at: number) => Math.floor((at - begin) / size);
  const stores = new Map<
    string,
    {
      storeId: string;
      restocks: number;
      exposureSeconds: number;
      availableSeconds: number;
      days: Set<string>;
    }
  >();
  const store = (id: string) => {
    if (!stores.has(id))
      stores.set(id, {
        storeId: id,
        restocks: 0,
        exposureSeconds: 0,
        availableSeconds: 0,
        days: new Set(),
      });
    return stores.get(id)!;
  };
  for (const e of events) {
    if (e.at < from || e.at >= to) continue;
    buckets[index(e.at)][e.kind === "restock" ? "restocks" : e.kind]++;
    if (e.kind === "restock") store(e.storeId).restocks++;
  }
  for (const interval of intervals) {
    const start = Math.max(from, interval.start),
      end = Math.min(to, interval.end);
    if (end <= start) continue;
    const s = store(interval.storeId);
    s.exposureSeconds += (end - start) / 1000;
    if (interval.status === "available")
      s.availableSeconds += (end - start) / 1000;
    for (let i = index(start); i < buckets.length && buckets[i].at < end; i++) {
      const b = buckets[i],
        seconds = (Math.min(end, b.at + size) - Math.max(start, b.at)) / 1000;
      b.exposureSeconds += seconds;
      if (interval.status === "available") {
        b.availableSeconds += seconds;
        s.days.add(b.date);
      }
    }
  }
  for (const b of buckets) {
    const duration = (Math.min(to, b.at + size) - Math.max(from, b.at)) / 1000;
    b.coverageRatio = pairCount
      ? Math.min(1, b.exposureSeconds / (pairCount * duration))
      : 0;
    b.rate = b.exposureSeconds ? b.restocks / (b.exposureSeconds / 3600) : null;
  }
  const totals = buckets.reduce(
    (t, b) => ({
      restocks: t.restocks + b.restocks,
      initial: t.initial + b.initial,
      recovery: t.recovery + b.recovery,
      exposureSeconds: t.exposureSeconds + b.exposureSeconds,
      availableSeconds: t.availableSeconds + b.availableSeconds,
    }),
    {
      restocks: 0,
      initial: 0,
      recovery: 0,
      exposureSeconds: 0,
      availableSeconds: 0,
    },
  );
  const timeSlots = new Map<
    string,
    {
      time: string;
      restocks: number;
      exposureSeconds: number;
      coverageRatio: number;
      count: number;
    }
  >();
  for (const b of buckets) {
    const s = timeSlots.get(b.time) ?? {
      time: b.time,
      restocks: 0,
      exposureSeconds: 0,
      coverageRatio: 0,
      count: 0,
    };
    s.restocks += b.restocks;
    s.exposureSeconds += b.exposureSeconds;
    s.coverageRatio += b.coverageRatio;
    s.count++;
    timeSlots.set(b.time, s);
  }
  return {
    buckets,
    totals,
    pairCount,
    coverageRatio:
      pairCount && to > from
        ? Math.min(
            1,
            totals.exposureSeconds / ((pairCount * (to - from)) / 1000),
          )
        : 0,
    ranking: [...timeSlots.values()]
      .map((s) => ({
        ...s,
        coverageRatio: s.coverageRatio / s.count,
        rate: s.exposureSeconds
          ? s.restocks / (s.exposureSeconds / 3600)
          : null,
      }))
      .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1)),
    stores: [...stores.values()]
      .map((s) => ({
        ...s,
        availableDays: s.days.size,
        days: undefined,
        rate: s.exposureSeconds
          ? s.restocks / (s.exposureSeconds / 3600)
          : null,
      }))
      .sort((a, b) => b.restocks - a.restocks),
  };
}
export function nextWakeAt(
  status: { enabled: boolean; nextAt: number },
  deliveryAt: number | null,
  now: number,
) {
  const inventory = status.enabled
    ? Math.max(status.nextAt, (Math.floor(now / 30000) + 1) * 30000)
    : now + 30000;
  return Math.max(now + 1000, Math.min(inventory, deliveryAt ?? Infinity));
}
