-- Opt-outs that must survive erasure: keyed by an HMAC of the email or phone, never the value.
CREATE TABLE IF NOT EXISTS suppressions (
  hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
-- 1 when the booking was matched by our lead id (or confirmed by an admin); 0 for email-only matches.
ALTER TABLE leads ADD COLUMN booking_verified INTEGER NOT NULL DEFAULT 0;
