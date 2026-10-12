CREATE TABLE voice_calls (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  direction TEXT NOT NULL,
  conversation_id TEXT UNIQUE,
  lead_id TEXT,
  outbound_call_id TEXT,
  phone TEXT,
  status TEXT,
  started_at INTEGER,
  duration_s INTEGER,
  transcript TEXT,
  recording_url TEXT,
  summary TEXT,
  structured TEXT,
  cost REAL,
  match_kind TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_voice_lead ON voice_calls(lead_id);
ALTER TABLE leads ADD COLUMN do_not_call_at INTEGER;
