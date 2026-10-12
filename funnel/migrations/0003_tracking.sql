CREATE TABLE forward_log (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  destination TEXT NOT NULL,
  lead_id TEXT,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER,
  http_status INTEGER,
  error TEXT,
  match_keys TEXT,
  payload TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (event_id, destination)
);
CREATE INDEX idx_forward_retry ON forward_log(status, next_at);
CREATE INDEX idx_forward_created ON forward_log(created_at);
ALTER TABLE sessions ADD COLUMN region_code TEXT;
