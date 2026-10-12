CREATE TABLE outbound_calls (
  id TEXT PRIMARY KEY,
  lead_id TEXT,
  kind TEXT NOT NULL,
  phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  run_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  conversation_id TEXT,
  call_sid TEXT,
  outcome TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_calls_due ON outbound_calls(status, run_at);
CREATE INDEX idx_calls_lead ON outbound_calls(lead_id);
CREATE INDEX idx_calls_phone ON outbound_calls(phone, created_at);
ALTER TABLE leads ADD COLUMN call_consent_at INTEGER;
ALTER TABLE leads ADD COLUMN call_consent_text TEXT;
ALTER TABLE leads ADD COLUMN timezone TEXT;
