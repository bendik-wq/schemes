-- One live AI call per lead and kind, enforced by the database (exactly-once under concurrency).
CREATE UNIQUE INDEX IF NOT EXISTS idx_calls_live ON outbound_calls(lead_id, kind) WHERE status IN ('queued', 'dialing');
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
