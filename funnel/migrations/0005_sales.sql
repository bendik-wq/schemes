CREATE TABLE reps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'closer',
  tiers TEXT NOT NULL DEFAULT 'A,B',
  weight INTEGER NOT NULL DEFAULT 1,
  calendar_url TEXT,
  commission_pct REAL NOT NULL DEFAULT 0,
  monthly_target REAL NOT NULL DEFAULT 0,
  slack_user_id TEXT,
  discord_user_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
ALTER TABLE leads ADD COLUMN cash_collected REAL NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN closed_at INTEGER;
ALTER TABLE leads ADD COLUMN showed_at INTEGER;
ALTER TABLE leads ADD COLUMN lost_reason TEXT;
ALTER TABLE leads ADD COLUMN setter_id TEXT;
