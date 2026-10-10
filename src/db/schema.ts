import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
export const products = sqliteTable("products", {
  id: text().primaryKey(),
  model: text().notNull(),
  color: text().notNull(),
  capacity: text().notNull(),
  url: text().notNull(),
  active: integer({ mode: "boolean" }).notNull(),
});
export const stores = sqliteTable("stores", {
  id: text().primaryKey(),
  name: text().notNull(),
});
export const watches = sqliteTable("watches", {
  id: text().primaryKey(),
  name: text().notNull(),
  productIds: text({ mode: "json" }).$type<string[]>().notNull(),
  storeIds: text({ mode: "json" }).$type<string[]>().notNull(),
  enabled: integer({ mode: "boolean" }).notNull(),
});
export const states = sqliteTable("states", {
  id: text().primaryKey(),
  productId: text("product_id").notNull(),
  storeId: text("store_id").notNull(),
  status: text().notNull(),
  confirmed: text(),
  checkedAt: integer("checked_at"),
  attemptedAt: integer("attempted_at").notNull(),
  segmentId: text("segment_id"),
});
export const events = sqliteTable(
  "events",
  {
    id: text().primaryKey(),
    productId: text("product_id").notNull(),
    storeId: text("store_id").notNull(),
    at: integer().notNull(),
    kind: text().notNull(),
  },
  (t) => [index("events_at").on(t.at)],
);
export const intervals = sqliteTable(
  "intervals",
  {
    id: text().primaryKey(),
    productId: text("product_id").notNull(),
    storeId: text("store_id").notNull(),
    start: integer().notNull(),
    end: integer().notNull(),
    status: text().notNull(),
  },
  (t) => [index("intervals_end").on(t.end)],
);
export const rounds = sqliteTable("rounds", {
  id: text().primaryKey(),
  at: integer().notNull(),
  status: text().notNull(),
});
export const queryCounts = sqliteTable(
  "query_counts",
  {
    id: text().primaryKey(),
    productId: text("product_id").notNull(),
    storeId: text("store_id").notNull(),
    at: integer().notNull(),
    available: integer().notNull(),
    unavailable: integer().notNull(),
    unknown: integer().notNull(),
    lastAt: integer("last_at").notNull(),
  },
  (t) => [index("query_counts_at").on(t.at)],
);
export const settings = sqliteTable("settings", {
  key: text().primaryKey(),
  value: text().notNull(),
});
export const notifications = sqliteTable("notifications", {
  id: text().primaryKey(),
  createdAt: integer("created_at").notNull(),
  attempts: integer().notNull(),
  nextAt: integer("next_at").notNull(),
  status: text().notNull(),
  message: text({ mode: "json" })
    .$type<{ title: string; body: string; url: string }>()
    .notNull(),
});
export const diagnostics = sqliteTable("diagnostics", {
  id: text().primaryKey(),
  at: integer().notNull(),
  message: text().notNull(),
});
