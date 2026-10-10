export type Stock = "available" | "unavailable" | "unknown";
export type EventKind = "restock" | "initial" | "recovery";
export interface Product {
  id: string;
  model: string;
  color: string;
  capacity: string;
  url: string;
  active: boolean;
}
export interface Store {
  id: string;
  name: string;
}
export interface Watch {
  id: string;
  name: string;
  productIds: string[];
  storeIds: string[];
  enabled: boolean;
}
export interface Observation {
  productId: string;
  storeId: string;
  status: Stock;
}
export interface StockState extends Observation {
  confirmed: Exclude<Stock, "unknown"> | null;
  checkedAt: number | null;
  attemptedAt: number;
  segmentId: string | null;
}
export interface StockEvent {
  id?: string;
  productId: string;
  storeId: string;
  at: number;
  kind: EventKind;
}
export interface Interval {
  id?: string;
  productId: string;
  storeId: string;
  start: number;
  end: number;
  status: Exclude<Stock, "unknown">;
}
export interface QueryCount {
  id: string;
  productId: string;
  storeId: string;
  /** Start of a 15-minute HK time slot. */
  at: number;
  available: number;
  unavailable: number;
  unknown: number;
  lastAt: number;
}
export type QuerySummary = Omit<QueryCount, "id" | "productId">;
export interface Filter {
  from: number;
  to: number;
  model?: string;
  color?: string;
  capacity?: string;
  storeId?: string;
  productId?: string;
}
export interface BarkMessage {
  title: string;
  body: string;
  url: string;
}
export interface Notification {
  id: string;
  createdAt: number;
  attempts: number;
  nextAt: number;
  status: "pending" | "sending" | "sent" | "failed" | "expired";
  message: BarkMessage;
}
export interface MonitorStatus {
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  nextAt: number;
  failures: number;
  error: string | null;
  catalogAt: number | null;
  enabled: boolean;
  maintenance: boolean;
}
export interface PickupResult {
  observations: Observation[];
  stores: Store[];
}
export interface InventoryProvider {
  catalog(): Promise<Product[]>;
  pickup(products: string[], stores: string[]): Promise<PickupResult>;
}
