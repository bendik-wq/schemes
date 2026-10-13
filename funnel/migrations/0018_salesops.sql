-- Sales operations, part 1: receivables (instalments), users and roles, audit log, touches,
-- pipeline stage markers and the scoring model each lead was scored with.
-- New per-lead fields go on lead_revops (leads is close to D1's 100-column limit).

-- One row per instalment of a won deal on a payment plan. Paid rows link to the payments ledger.
CREATE TABLE IF NOT EXISTS receivables (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  seq INTEGER NOT NULL,                       -- 1..n within the plan
  due_at INTEGER NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  paid_payment_id TEXT,
  reminded_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_receivables_lead ON receivables(lead_id);
CREATE INDEX IF NOT EXISTS idx_receivables_due ON receivables(status, due_at);
CREATE INDEX IF NOT EXISTS idx_receivables_payment ON receivables(paid_payment_id);

-- Funnel HQ users. The ADMIN_PASSWORD login stays as the owner's break-glass account.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'closer', 'setter', 'viewer')),
  rep_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

-- Who changed what. before/after hold changed fields only; integration changes record key names, never values.
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  user_id TEXT,                               -- users.id, 'owner' (password login) or 'link:<rep>' (signed outcome link)
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  before TEXT,
  after TEXT,
  ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);

-- Human touches by setters and closers (speed-to-lead, setter activity).
CREATE TABLE IF NOT EXISTS touches (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  rep_id TEXT,
  user_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('dial', 'connect', 'voicemail', 'sms', 'email', 'dm')),
  outcome TEXT,
  note TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_touches_lead ON touches(lead_id, at);
CREATE INDEX IF NOT EXISTS idx_touches_rep ON touches(rep_id, at);

-- Pipeline: 'verbal' marks a held call with a verbal yes / contract out. Kept after the deal closes (history).
ALTER TABLE lead_revops ADD COLUMN pipeline_stage TEXT;
ALTER TABLE lead_revops ADD COLUMN pipeline_stage_at INTEGER;
-- 'config' or the learned-points version that produced the lead's score (from score_breakdown).
ALTER TABLE lead_revops ADD COLUMN score_model TEXT;

CREATE TRIGGER IF NOT EXISTS trg_leads_score_model AFTER UPDATE OF score_breakdown ON leads
WHEN NEW.score_breakdown IS NOT NULL AND json_valid(NEW.score_breakdown)
BEGIN
  INSERT OR IGNORE INTO lead_revops (lead_id, updated_at) VALUES (NEW.id, NEW.updated_at);
  UPDATE lead_revops SET score_model = COALESCE(
      (SELECT json_extract(j.value, '$.label') FROM json_each(NEW.score_breakdown, '$.lines') j WHERE json_extract(j.value, '$.id') = 'model' LIMIT 1),
      'config'),
    updated_at = NEW.updated_at
  WHERE lead_id = NEW.id;
END;

CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_visitor ON leads(visitor_id);
CREATE INDEX IF NOT EXISTS idx_leads_closer ON leads(closer_id);
CREATE INDEX IF NOT EXISTS idx_leads_updated ON leads(updated_at);
