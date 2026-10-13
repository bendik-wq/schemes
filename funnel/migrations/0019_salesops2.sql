-- Sales operations, part 2: public API keys and signed outbound webhooks.

-- Keys look like fk_<prefix>_<secret>. Only an HMAC of the whole key is stored; the key is shown once.
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,                        -- the public prefix
  name TEXT NOT NULL,
  hash TEXT NOT NULL,
  scopes TEXT NOT NULL,                       -- comma-separated, e.g. leads:read,payments:read
  created_at INTEGER NOT NULL,
  created_by TEXT,
  last_used_at INTEGER,
  revoked_at INTEGER
);

-- Outbound webhook subscriptions. Deliveries go through forward_log (destination wh_<id>) with its retries.
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  events TEXT NOT NULL,                       -- comma-separated event names or *
  secret TEXT NOT NULL,                       -- signing secret (shown once); needed to sign every delivery
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at);
CREATE INDEX IF NOT EXISTS idx_ad_spend_updated ON ad_spend(updated_at);
