-- Round 3 messaging: text reminders (consent per number, queue and log) and C-tier review requests.
-- Side tables only: `leads` sits near D1's 100-column limit. Everything here is erased with the lead,
-- except a STOP, which is kept as an HMAC in `suppressions` (kind 'sms') like other opt-outs.

-- "Think we got this wrong? Ask for a review" on /resources (signed /go/review link).
ALTER TABLE lead_revops ADD COLUMN review_requested_at INTEGER;

-- Explicit consent to text reminders, per E.164 number. Separate from the AI-call consent and unticked by default.
-- consent_at NULL = no consent (never given, unticked, or withdrawn); stopped_at = STOP received.
CREATE TABLE IF NOT EXISTS sms_consent (
  phone TEXT PRIMARY KEY,
  lead_id TEXT,
  consent_at INTEGER,
  consent_text TEXT,
  stopped_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sms_consent_lead ON sms_consent(lead_id);

-- Outbound reminders (kind booked · 24h · 1h, one per call time) and inbound replies (kind stop · help · confirm · other).
-- status: pending · sending · sent · delivered · simulated · failed · skipped · cancelled · received.
CREATE TABLE IF NOT EXISTS sms_messages (
  id TEXT PRIMARY KEY,
  lead_id TEXT,
  kind TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'out' CHECK (direction IN ('out','in')),
  phone TEXT,
  call_at INTEGER,
  send_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  body TEXT,
  provider_id TEXT,
  error TEXT,
  sent_at INTEGER,
  delivered_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_once ON sms_messages(lead_id, kind, call_at) WHERE direction = 'out';
CREATE INDEX IF NOT EXISTS idx_sms_due ON sms_messages(status, send_at);
CREATE INDEX IF NOT EXISTS idx_sms_provider ON sms_messages(provider_id);
CREATE INDEX IF NOT EXISTS idx_sms_lead ON sms_messages(lead_id);

-- Marketing cap and the go-live backlog skip look up a lead's recent sends and old pending rows.
CREATE INDEX IF NOT EXISTS idx_emails_lead_sent ON emails(lead_id, sent_at);

CREATE TRIGGER IF NOT EXISTS trg_leads_messaging_erase AFTER DELETE ON leads
BEGIN
  DELETE FROM sms_consent WHERE lead_id = OLD.id OR (OLD.phone IS NOT NULL AND phone = OLD.phone);
  DELETE FROM sms_messages WHERE lead_id = OLD.id OR (OLD.phone IS NOT NULL AND phone = OLD.phone);
END;
