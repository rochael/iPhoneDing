CREATE TABLE IF NOT EXISTS query_counts (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  available INTEGER NOT NULL CHECK(available >= 0),
  unavailable INTEGER NOT NULL CHECK(unavailable >= 0),
  unknown INTEGER NOT NULL CHECK(unknown >= 0),
  last_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS query_counts_at ON query_counts(at);
