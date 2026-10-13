-- Round 2 growth: proof, cohorts, referrals and experiments. Side tables only: D1 caps a table at
-- 100 columns and `leads` is close to it. Triggers stamp referrals and experiment exposures on new
-- leads (any creation path) and clean every side table when a lead or visitor is erased.

-- ── Proof (testimonials, screenshots, metrics) ────────────────────────────────
-- Renders only when approved = 1 AND consent_at IS NOT NULL AND consent_scope contains "site".
CREATE TABLE IF NOT EXISTS proof (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('quote','video','screenshot','logo','build_log','metric')),
  body TEXT NOT NULL DEFAULT '',
  author_name TEXT,
  author_role TEXT,
  company TEXT,
  industry TEXT,
  media_url TEXT,
  consent_at INTEGER,
  -- Comma list of what the person agreed to: site, name, company, email, ads.
  consent_scope TEXT,
  approved INTEGER NOT NULL DEFAULT 0,
  lead_id TEXT,
  source TEXT NOT NULL DEFAULT 'admin',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_proof_live ON proof(approved, industry);
CREATE INDEX IF NOT EXISTS idx_proof_lead ON proof(lead_id);

-- ── Cohorts ──────────────────────────────────────────────────────────────────
-- starts_on / apply_by are calendar dates (YYYY-MM-DD). Seats taken = explicit members + won leads
-- (not refunded, no member row) whose closed_at falls in the cohort's window (see src/growth/cohorts.ts).
CREATE TABLE IF NOT EXISTS cohorts (
  id TEXT PRIMARY KEY,
  starts_on TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  apply_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('draft','open','closed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cohort_members (
  lead_id TEXT PRIMARY KEY,
  cohort_id TEXT NOT NULL,
  assigned_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cohort_members ON cohort_members(cohort_id);
-- One "applications close soon" email per lead per cohort.
CREATE TABLE IF NOT EXISTS cohort_notices (
  cohort_id TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (cohort_id, lead_id)
);

-- ── Referrals ────────────────────────────────────────────────────────────────
-- First touch only: the first referral link a visitor arrived through.
CREATE TABLE IF NOT EXISTS visitor_referrals (
  visitor_id TEXT PRIMARY KEY,
  ref_code TEXT NOT NULL,
  referrer_lead_id TEXT NOT NULL,
  first_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_visitor_referrals_by ON visitor_referrals(referrer_lead_id);
CREATE TABLE IF NOT EXISTS lead_referrals (
  lead_id TEXT PRIMARY KEY,
  referrer_lead_id TEXT NOT NULL,
  ref_code TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lead_referrals_by ON lead_referrals(referrer_lead_id);

-- ── Experiments ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  slot TEXT NOT NULL,
  name TEXT NOT NULL,
  variants_json TEXT NOT NULL,
  weights TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','running','stopped')),
  started_at INTEGER,
  ended_at INTEGER,
  created_at INTEGER NOT NULL
);
-- At most one running experiment per slot.
CREATE UNIQUE INDEX IF NOT EXISTS idx_experiments_running ON experiments(slot) WHERE status = 'running';
CREATE TABLE IF NOT EXISTS assignments (
  visitor_id TEXT NOT NULL,
  exp_id TEXT NOT NULL,
  variant TEXT NOT NULL,
  assigned_at INTEGER NOT NULL,
  PRIMARY KEY (visitor_id, exp_id)
);
CREATE INDEX IF NOT EXISTS idx_assignments_exp ON assignments(exp_id, variant);
CREATE TABLE IF NOT EXISTS lead_exposures (
  lead_id TEXT NOT NULL,
  exp_id TEXT NOT NULL,
  variant TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (lead_id, exp_id)
);
CREATE INDEX IF NOT EXISTS idx_lead_exposures_exp ON lead_exposures(exp_id, variant);

-- ── Stamping on lead creation (every path that inserts a lead) ───────────────
CREATE TRIGGER IF NOT EXISTS trg_leads_growth_stamp AFTER INSERT ON leads
WHEN NEW.visitor_id IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO lead_referrals (lead_id, referrer_lead_id, ref_code, created_at)
  SELECT NEW.id, vr.referrer_lead_id, vr.ref_code, NEW.created_at FROM visitor_referrals vr
  WHERE vr.visitor_id = NEW.visitor_id AND vr.referrer_lead_id != NEW.id;
  INSERT OR IGNORE INTO lead_exposures (lead_id, exp_id, variant, at)
  SELECT NEW.id, a.exp_id, a.variant, NEW.created_at FROM assignments a WHERE a.visitor_id = NEW.visitor_id;
END;

-- ── Erasure: nothing in the side tables outlives the lead or visitor ─────────
CREATE TRIGGER IF NOT EXISTS trg_leads_growth_erase AFTER DELETE ON leads
BEGIN
  DELETE FROM lead_referrals WHERE lead_id = OLD.id OR referrer_lead_id = OLD.id;
  DELETE FROM visitor_referrals WHERE referrer_lead_id = OLD.id;
  DELETE FROM lead_exposures WHERE lead_id = OLD.id;
  DELETE FROM cohort_members WHERE lead_id = OLD.id;
  DELETE FROM cohort_notices WHERE lead_id = OLD.id;
  DELETE FROM proof WHERE lead_id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_visitors_growth_erase AFTER DELETE ON visitors
BEGIN
  DELETE FROM assignments WHERE visitor_id = OLD.id;
  DELETE FROM visitor_referrals WHERE visitor_id = OLD.id;
END;
