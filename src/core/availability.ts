import { aggregate, hkDate } from "./domain";
import type { QuerySummary } from "./types";

function counts() {
  return {
    availableChecks: 0,
    unavailableChecks: 0,
    unknownChecks: 0,
    validChecks: 0,
    hitRate: null as number | null,
  };
}
type Counts = ReturnType<typeof counts>;
function add(
  target: Counts,
  available: number,
  unavailable: number,
  unknown: number,
) {
  target.availableChecks += available;
  target.unavailableChecks += unavailable;
  target.unknownChecks += unknown;
  target.validChecks = target.availableChecks + target.unavailableChecks;
  target.hitRate = target.validChecks
    ? target.availableChecks / target.validChecks
    : null;
}
const rank = (a: Counts, b: Counts) =>
  (b.hitRate ?? -1) - (a.hitRate ?? -1) || b.validChecks - a.validChecks;

export function aggregateAvailability(
  input: Parameters<typeof aggregate>[0] & { queries: QuerySummary[] },
) {
  const coverage = aggregate(input);
  const buckets = coverage.buckets.map((b) => ({ ...b, ...counts() }));
  const totals = { ...coverage.totals, ...counts() };
  const stores = new Map(
    coverage.stores.map((s) => [
      s.storeId,
      { ...s, ...counts(), sampleDays: new Set<string>() },
    ]),
  );
  const size = input.minutes * 60000;
  const begin = buckets[0]?.at ?? input.from;
  for (const q of input.queries) {
    if (q.at < input.from || q.at >= input.to) continue;
    const b = buckets[Math.floor((q.at - begin) / size)];
    if (!b) continue;
    add(b, q.available, q.unavailable, q.unknown);
    add(totals, q.available, q.unavailable, q.unknown);
    if (!stores.has(q.storeId))
      stores.set(q.storeId, {
        storeId: q.storeId,
        restocks: 0,
        exposureSeconds: 0,
        availableSeconds: 0,
        availableDays: 0,
        days: undefined,
        rate: null,
        ...counts(),
        sampleDays: new Set<string>(),
      });
    const s = stores.get(q.storeId)!;
    add(s, q.available, q.unavailable, q.unknown);
    if (q.available) s.sampleDays.add(hkDate(q.at));
  }
  const slots = new Map(
    coverage.ranking.map((s) => [s.time, { ...s, ...counts() }]),
  );
  for (const b of buckets)
    add(
      slots.get(b.time)!,
      b.availableChecks,
      b.unavailableChecks,
      b.unknownChecks,
    );
  return {
    ...coverage,
    buckets,
    totals,
    ranking: [...slots.values()].sort(rank),
    stores: [...stores.values()]
      .map(({ sampleDays, ...s }) => ({ ...s, availableDays: sampleDays.size }))
      .sort(rank),
  };
}
