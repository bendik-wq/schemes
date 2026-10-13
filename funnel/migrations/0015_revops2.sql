-- Revenue operations, part 2: scoring calibration, no-show risk, deliverability, AI reports.

CREATE TABLE IF NOT EXISTS scoring_models (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'win',  -- 'win' (P(won)) or 'noshow'
  n_train INTEGER NOT NULL,
  auc REAL,
  brier REAL,
  weights TEXT NOT NULL,             -- JSON: {features, weights, bias, ...report}
  active INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_models_kind ON scoring_models(kind, created_at);


ALTER TABLE emails ADD COLUMN delivered_at INTEGER;
ALTER TABLE emails ADD COLUMN delayed_at INTEGER;
ALTER TABLE emails ADD COLUMN bounced_at INTEGER;
ALTER TABLE emails ADD COLUMN bounce_type TEXT;
ALTER TABLE emails ADD COLUMN complained_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_emails_provider ON emails(provider_id);
CREATE INDEX IF NOT EXISTS idx_emails_sent ON emails(sent_at);

CREATE TABLE IF NOT EXISTS ai_reports (
  id TEXT PRIMARY KEY,
  week TEXT NOT NULL UNIQUE,         -- ISO week, e.g. 2026-W42
  json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
