import { drizzle } from "drizzle-orm/sqlite-proxy";
import { and, or, eq, gte, lt, gt, desc, inArray, sql } from "drizzle-orm";
import * as tables from "./schema";
import type { SqlDriver, Statement } from "./driver";
import type {
  Product,
  Store,
  Watch,
  StockState,
  StockEvent,
  Interval,
  Filter,
  Observation,
  Notification,
  MonitorStatus,
  BarkMessage,
  QueryCount,
  QuerySummary,
} from "../core/types";
import { transition, GAP_MS } from "../core/domain";
const stateId = (p: string, s: string) => `${p}|${s}`;
function chunks<T>(rows: T[], size: number) {
  const result: T[][] = [];
  for (let i = 0; i < rows.length; i += size)
    result.push(rows.slice(i, i + size));
  return result;
}
const query = (q: { toSQL(): { sql: string; params: unknown[] } }): Statement =>
  q.toSQL();
export class Repository {
  readonly db;
  constructor(readonly driver: SqlDriver) {
    this.db = drizzle(
      async (sqlText, params, method) => {
        if (method === "run") {
          await driver.run({ sql: sqlText, params });
          return { rows: [] };
        }
        const rows = await driver.rows({ sql: sqlText, params });
        return { rows: method === "get" ? (rows[0] ?? []) : rows };
      },
      { schema: tables },
    );
  }
  async catalog() {
    return {
      products: await this.db.select().from(tables.products),
      stores: await this.db.select().from(tables.stores),
    };
  }
  async saveCatalog(products: Product[], stores: Store[], at: number) {
    const commands: Statement[] = [];
    if (products.length) {
      commands.push(
        query(this.db.update(tables.products).set({ active: false })),
      );
      for (const group of chunks(products, 16))
        commands.push(
          query(
            this.db
              .insert(tables.products)
              .values(group)
              .onConflictDoUpdate({
                target: tables.products.id,
                set: {
                  model: sql`excluded.model`,
                  color: sql`excluded.color`,
                  capacity: sql`excluded.capacity`,
                  url: sql`excluded.url`,
                  active: sql`excluded.active`,
                },
              }),
          ),
        );
      commands.push(this.settingCommand("catalogAt", String(at)));
    }
    for (const group of chunks(stores, 40))
      commands.push(
        query(
          this.db
            .insert(tables.stores)
            .values(group)
            .onConflictDoUpdate({
              target: tables.stores.id,
              set: { name: sql`excluded.name` },
            }),
        ),
      );
    if (commands.length) {
      commands.unshift({
        sql: "INSERT INTO commit_guard(id,valid) SELECT 'catalog',CASE WHEN EXISTS(SELECT 1 FROM settings WHERE key IN ('maintenanceMode','importInProgress') AND value='true') THEN 0 ELSE 1 END",
        params: [],
      });
      commands.push({
        sql: "DELETE FROM commit_guard WHERE id='catalog'",
        params: [],
      });
      try {
        await this.driver.batch(commands);
      } catch (error) {
        if (
          (await this.setting("maintenanceMode")) !== "true" &&
          (await this.setting("importInProgress")) !== "true"
        )
          throw error;
      }
    }
  }
  async watches() {
    return this.db.select().from(tables.watches);
  }
  async saveWatch(w: Watch, now = Date.now()) {
    const previous = (await this.watches()).find((x) => x.id === w.id);
    const commands = [
      query(
        this.db
          .insert(tables.watches)
          .values(w)
          .onConflictDoUpdate({ target: tables.watches.id, set: w }),
      ),
    ];
    if (w.enabled) {
      const fresh = (await this.stock()).filter(
        (s) =>
          s.status === "available" &&
          s.checkedAt !== null &&
          now - s.checkedAt <= GAP_MS &&
          w.productIds.includes(s.productId) &&
          w.storeIds.includes(s.storeId) &&
          (!previous?.enabled ||
            !previous.productIds.includes(s.productId) ||
            !previous.storeIds.includes(s.storeId)),
      );
      if (fresh.length) {
        const c = await this.catalog(),
          message = {
            title: `iPhone 到货 · ${fresh.length} 个门店规格`,
            body: fresh
              .map((s) => {
                const p = c.products.find((p) => p.id === s.productId);
                return `${p?.model ?? s.productId} ${p?.color ?? ""} ${p?.capacity ?? ""} · ${c.stores.find((x) => x.id === s.storeId)?.name ?? s.storeId}`;
              })
              .join("\n"),
            url:
              c.products.find((p) => p.id === fresh[0].productId)?.url ??
              "https://www.apple.com/hk/shop/buy-iphone/iphone-18-pro",
          };
        commands.push(
          query(
            this.db.insert(tables.notifications).values({
              id: `watch-${w.id}-${crypto.randomUUID()}`,
              createdAt: now,
              nextAt: now,
              attempts: 0,
              status: "pending",
              message,
            }),
          ),
        );
      }
    }
    await this.driver.batch(commands);
  }
  async deleteWatch(id: string) {
    await this.db.delete(tables.watches).where(eq(tables.watches.id, id));
  }
  async stock() {
    return (await this.db.select().from(tables.states)) as StockState[];
  }
  async setting(key: string) {
    return (
      await this.db
        .select()
        .from(tables.settings)
        .where(eq(tables.settings.key, key))
    )[0]?.value;
  }
  settingCommand(key: string, value: string) {
    return query(
      this.db
        .insert(tables.settings)
        .values({ key, value })
        .onConflictDoUpdate({ target: tables.settings.key, set: { value } }),
    );
  }
  async setSetting(key: string, value: string) {
    await this.driver.run(this.settingCommand(key, value));
  }
  async status(): Promise<MonitorStatus> {
    const saved = await this.setting("monitorStatus");
    const catalogAt = Number(await this.setting("catalogAt")) || null;
    return {
      ...{
        lastAttemptAt: null,
        lastSuccessAt: null,
        nextAt: 0,
        failures: 0,
        error: null,
      },
      ...(saved ? JSON.parse(saved) : {}),
      catalogAt,
      enabled: (await this.setting("monitorEnabled")) !== "false",
      maintenance: (await this.setting("maintenanceMode")) === "true",
    };
  }
  async acquire(id: string, now: number) {
    const rows = await this.driver.objects({
      sql: "UPDATE locks SET owner=?,expires=? WHERE id='monitor' AND expires<=? AND NOT EXISTS(SELECT 1 FROM settings WHERE (key='monitorEnabled' AND value='false') OR (key IN ('maintenanceMode','importInProgress') AND value='true')) AND NOT EXISTS(SELECT 1 FROM rounds WHERE id=?) RETURNING owner",
      params: [id, now + 180_000, now, id],
    });
    if (!rows.length) return false;
    await this.db
      .insert(tables.rounds)
      .values({ id, at: now, status: "running" })
      .onConflictDoNothing();
    return true;
  }
  private guard(id: string, at: number): Statement {
    return {
      sql: "INSERT INTO commit_guard(id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM locks WHERE id='monitor' AND owner=? AND expires>?) THEN 1 ELSE 0 END",
      params: [id, id, at],
    };
  }
  async commitRound(
    id: string,
    observations: Observation[],
    at: number,
    messages: BarkMessage[],
    status?: MonitorStatus,
  ) {
    const existing = new Map(
      (await this.stock()).map((s) => [stateId(s.productId, s.storeId), s]),
    );
    const commands: Statement[] = [this.guard(id, at)];
    const additions: StockEvent[] = [];
    const intervalRows: (typeof tables.intervals.$inferInsert)[] = [];
    const stateRows: (typeof tables.states.$inferInsert)[] = [];
    const unique = [
      ...new Map(
        observations.map((o) => [stateId(o.productId, o.storeId), o]),
      ).values(),
    ];
    for (const o of unique) {
      const key = stateId(o.productId, o.storeId),
        old = existing.get(key);
      const prior =
        old?.confirmed && old.checkedAt !== null
          ? { status: old.confirmed, checkedAt: old.checkedAt }
          : undefined;
      const t = transition(prior, o.status, at);
      let segmentId = old?.segmentId ?? null;
      if (o.status !== "unknown" && prior) {
        if (at - prior.checkedAt <= GAP_MS && at > prior.checkedAt) {
          segmentId ??= `${key}|${prior.checkedAt}`;
          intervalRows.push({
            id: segmentId,
            productId: o.productId,
            storeId: o.storeId,
            start: prior.checkedAt,
            end: at,
            status: prior.status,
          });
        } else segmentId = null;
        if (o.status !== prior.status) segmentId = null;
      }
      if (t.kind) {
        const e = {
          id: `${id}|${key}`,
          productId: o.productId,
          storeId: o.storeId,
          at,
          kind: t.kind,
        };
        additions.push(e);
      }
      const row = {
        id: key,
        ...o,
        confirmed: o.status === "unknown" ? (old?.confirmed ?? null) : o.status,
        checkedAt: o.status === "unknown" ? (old?.checkedAt ?? null) : at,
        attemptedAt: at,
        segmentId,
      };
      stateRows.push(row);
    }
    for (const group of chunks(intervalRows, 16))
      commands.push(
        query(
          this.db
            .insert(tables.intervals)
            .values(group)
            .onConflictDoUpdate({
              target: tables.intervals.id,
              set: { end: sql`excluded.end` },
            }),
        ),
      );
    for (const group of chunks(additions, 16))
      commands.push(
        query(
          this.db
            .insert(tables.events)
            .values(group as (typeof tables.events.$inferInsert)[])
            .onConflictDoNothing(),
        ),
      );
    for (const group of chunks(stateRows, 12))
      commands.push(
        query(
          this.db
            .insert(tables.states)
            .values(group)
            .onConflictDoUpdate({
              target: tables.states.id,
              set: {
                status: sql`excluded.status`,
                confirmed: sql`excluded.confirmed`,
                checkedAt: sql`excluded.checked_at`,
                attemptedAt: sql`excluded.attempted_at`,
                segmentId: sql`excluded.segment_id`,
              },
            }),
        ),
      );
    if (unique.length) {
      const bucketAt = Math.floor(at / 900000) * 900000;
      // Read only this round's updated pairs. JSON keeps a full 192-pair round
      // to one statement with four bindings on both SQLite and D1.
      commands.push(
        {
          sql: `INSERT INTO query_counts(id,product_id,store_id,at,available,unavailable,unknown,last_at)
          SELECT id||'|'||?,product_id,store_id,?,CASE WHEN status='available' THEN 1 ELSE 0 END,
          CASE WHEN status='unavailable' THEN 1 ELSE 0 END,CASE WHEN status='unknown' THEN 1 ELSE 0 END,attempted_at
          FROM states WHERE attempted_at=? AND id IN (SELECT value FROM json_each(?))
          ON CONFLICT(id) DO UPDATE SET available=query_counts.available+excluded.available,
          unavailable=query_counts.unavailable+excluded.unavailable,unknown=query_counts.unknown+excluded.unknown,
          last_at=MAX(query_counts.last_at,excluded.last_at)`,
          params: [
            bucketAt,
            bucketAt,
            at,
            JSON.stringify(unique.map((o) => stateId(o.productId, o.storeId))),
          ],
        },
        {
          sql: "INSERT OR IGNORE INTO settings(key,value) VALUES ('queryCountsStartedAt',?)",
          params: [String(at)],
        },
      );
    }
    messages.forEach((message, i) =>
      commands.push(
        query(
          this.db
            .insert(tables.notifications)
            .values({
              id: `${id}|${i}`,
              createdAt: at,
              nextAt: at,
              attempts: 0,
              status: "pending",
              message,
            })
            .onConflictDoNothing(),
        ),
      ),
    );
    if (status?.error)
      commands.push(
        query(
          this.db
            .insert(tables.diagnostics)
            .values({ id, at, message: status.error })
            .onConflictDoNothing(),
        ),
      );
    if (status)
      commands.push(
        this.settingCommand("monitorStatus", JSON.stringify(status)),
      );
    commands.push(
      query(
        this.db
          .update(tables.rounds)
          .set({ status: "complete" })
          .where(eq(tables.rounds.id, id)),
      ),
    );
    commands.push(
      {
        sql: "UPDATE locks SET owner=NULL,expires=0 WHERE id='monitor' AND owner=?",
        params: [id],
      },
      { sql: "DELETE FROM commit_guard WHERE id=?", params: [id] },
    );
    await this.driver.batch(commands);
    return additions;
  }
  async abandon(id: string, status: MonitorStatus, at: number) {
    await this.driver.batch([
      this.guard(id, at),
      this.settingCommand("monitorStatus", JSON.stringify(status)),
      query(
        this.db
          .insert(tables.diagnostics)
          .values({ id, at, message: status.error ?? "查询失败" })
          .onConflictDoNothing(),
      ),
      query(
        this.db
          .update(tables.rounds)
          .set({ status: "failed" })
          .where(eq(tables.rounds.id, id)),
      ),
      {
        sql: "UPDATE locks SET owner=NULL,expires=0 WHERE id='monitor' AND owner=?",
        params: [id],
      },
      { sql: "DELETE FROM commit_guard WHERE id=?", params: [id] },
    ]);
  }
  async pending(now: number) {
    return (await this.db
      .select()
      .from(tables.notifications)
      .where(
        and(
          or(
            eq(tables.notifications.status, "pending"),
            eq(tables.notifications.status, "sending"),
          ),
          lt(tables.notifications.nextAt, now + 1),
        ),
      )
      .limit(10)) as Notification[];
  }
  async nextDeliveryAt() {
    if (
      (await this.setting("maintenanceMode")) === "true" ||
      (await this.setting("importInProgress")) === "true"
    )
      return null;
    const hasBark = !!(await this.setting("barkUrl"));
    const result = await this.driver.objects({
      sql: hasBark
        ? "SELECT MIN(MIN(next_at,created_at+300001)) AS at FROM notifications WHERE status IN ('pending','sending')"
        : "SELECT MIN(created_at+300001) AS at FROM notifications WHERE status IN ('pending','sending')",
      params: [],
    });
    return result[0]?.at === null || result[0]?.at === undefined
      ? null
      : Number(result[0].at);
  }
  async claimNotification(id: string, now: number) {
    return (
      (await this.driver.run({
        sql: "UPDATE notifications SET status='sending',attempts=attempts+1,next_at=? WHERE id=? AND status IN ('pending','sending') AND next_at<=? AND NOT EXISTS(SELECT 1 FROM settings WHERE key IN ('maintenanceMode','importInProgress') AND value='true')",
        params: [now + 60000, id, now],
      })) > 0
    );
  }
  async updateNotification(n: Notification) {
    await this.db
      .update(tables.notifications)
      .set(n)
      .where(eq(tables.notifications.id, n.id));
  }
  async notificationLog() {
    return this.db
      .select({
        id: tables.notifications.id,
        createdAt: tables.notifications.createdAt,
        attempts: tables.notifications.attempts,
        status: tables.notifications.status,
      })
      .from(tables.notifications)
      .orderBy(desc(tables.notifications.createdAt))
      .limit(30);
  }
  private async filteredProducts(f: Filter) {
    return this.db
      .select()
      .from(tables.products)
      .where(
        and(
          f.model ? eq(tables.products.model, f.model) : undefined,
          f.color ? eq(tables.products.color, f.color) : undefined,
          f.capacity ? eq(tables.products.capacity, f.capacity) : undefined,
          f.productId ? eq(tables.products.id, f.productId) : undefined,
        ),
      );
  }
  private condition(
    table:
      | typeof tables.events
      | typeof tables.intervals
      | typeof tables.queryCounts,
    f: Filter,
    ids: string[],
  ) {
    return and(
      inArray(table.productId, ids.length ? ids : ["__empty__"]),
      f.storeId ? eq(table.storeId, f.storeId) : undefined,
    );
  }
  async events(f: Filter, page = 1, limit = 50) {
    const ps = await this.filteredProducts(f);
    const where = and(
      this.condition(
        tables.events,
        f,
        ps.map((p) => p.id),
      ),
      gte(tables.events.at, f.from),
      lt(tables.events.at, f.to),
    );
    const items = await this.db
      .select()
      .from(tables.events)
      .where(where)
      .orderBy(desc(tables.events.at), desc(tables.events.id))
      .limit(limit)
      .offset((page - 1) * limit);
    const counts = await this.db
      .select({ total: sql<number>`count(*)` })
      .from(tables.events)
      .where(where);
    return {
      items: items as StockEvent[],
      total: counts[0]?.total ?? 0,
      page,
      limit,
    };
  }
  async historyData(f: Filter) {
    const ps = await this.filteredProducts(f);
    const ids = ps.map((p) => p.id);
    const events = (await this.db
      .select()
      .from(tables.events)
      .where(
        and(
          this.condition(tables.events, f, ids),
          gte(tables.events.at, f.from),
          lt(tables.events.at, f.to),
        ),
      )) as StockEvent[];
    const intervals = (await this.db
      .select()
      .from(tables.intervals)
      .where(
        and(
          this.condition(tables.intervals, f, ids),
          gt(tables.intervals.end, f.from),
          lt(tables.intervals.start, f.to),
        ),
      )) as Interval[];
    const stores = (await this.catalog()).stores.filter(
      (s) => !f.storeId || s.id === f.storeId,
    );
    const queries = await this.db
      .select({
        at: tables.queryCounts.at,
        storeId: tables.queryCounts.storeId,
        available: sql<number>`sum(${tables.queryCounts.available})`,
        unavailable: sql<number>`sum(${tables.queryCounts.unavailable})`,
        unknown: sql<number>`sum(${tables.queryCounts.unknown})`,
        lastAt: sql<number>`max(${tables.queryCounts.lastAt})`,
      })
      .from(tables.queryCounts)
      .where(
        and(
          this.condition(tables.queryCounts, f, ids),
          gte(tables.queryCounts.at, f.from),
          lt(tables.queryCounts.at, f.to),
        ),
      )
      .groupBy(tables.queryCounts.at, tables.queryCounts.storeId);
    return {
      events,
      intervals,
      queries: queries as QuerySummary[],
      pairCount: ps.length * stores.length,
      queryCountsStartedAt:
        Number(await this.setting("queryCountsStartedAt")) || null,
    };
  }
  async queryCounts(f: Filter, page = 1, limit = 50, onlyAvailable = false) {
    const ps = await this.filteredProducts(f);
    const where = and(
      this.condition(
        tables.queryCounts,
        f,
        ps.map((p) => p.id),
      ),
      gte(tables.queryCounts.at, f.from),
      lt(tables.queryCounts.at, f.to),
      onlyAvailable ? gt(tables.queryCounts.available, 0) : undefined,
    );
    const items = await this.db
      .select()
      .from(tables.queryCounts)
      .where(where)
      .orderBy(desc(tables.queryCounts.at), desc(tables.queryCounts.id))
      .limit(limit)
      .offset((page - 1) * limit);
    const counts = await this.db
      .select({ total: sql<number>`count(*)` })
      .from(tables.queryCounts)
      .where(where);
    return {
      items: items as QueryCount[],
      total: counts[0]?.total ?? 0,
      page,
      limit,
    };
  }
  async diagnostics() {
    return this.db
      .select()
      .from(tables.diagnostics)
      .orderBy(desc(tables.diagnostics.at))
      .limit(20);
  }
  async prune(now: number) {
    await this.driver.batch([
      { sql: "DELETE FROM events WHERE at<?", params: [now - 365 * 86400000] },
      {
        sql: "DELETE FROM query_counts WHERE at<?",
        params: [now - 365 * 86400000],
      },
      {
        sql: "DELETE FROM intervals WHERE end<?",
        params: [now - 365 * 86400000],
      },
      {
        sql: "DELETE FROM diagnostics WHERE at<?",
        params: [now - 7 * 86400000],
      },
      { sql: "DELETE FROM rounds WHERE at<?", params: [now - 7 * 86400000] },
      {
        sql: "DELETE FROM notifications WHERE created_at<? AND status<>?",
        params: [now - 7 * 86400000, "pending"],
      },
    ]);
  }
  async loginAllowed(now: number) {
    const row = (
      await this.driver.objects({
        sql: "SELECT * FROM login_limits WHERE id='admin'",
        params: [],
      })
    )[0];
    return !row || Number(row.reset_at) <= now || Number(row.failures) < 10;
  }
  async loginFailure(now: number) {
    await this.driver.run({
      sql: "INSERT INTO login_limits(id,failures,reset_at) VALUES ('admin',1,?) ON CONFLICT(id) DO UPDATE SET failures=CASE WHEN reset_at<=? THEN 1 ELSE failures+1 END,reset_at=CASE WHEN reset_at<=? THEN ? ELSE reset_at END",
      params: [now + 900000, now, now, now + 900000],
    });
  }
  async clearLoginFailures() {
    await this.driver.run({
      sql: "DELETE FROM login_limits WHERE id='admin'",
      params: [],
    });
  }
}
