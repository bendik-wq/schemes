-- Funnel HQ round 3: test-data separation, call reviews (closer KPIs), written call plans, the
-- speed-to-lead escalation ladder and redirects for merged leads. Side tables only: `leads` is at
-- D1's 100-column limit. Every table keyed by a lead is cleaned by a trigger when the lead is erased
-- (src/sales/erase.ts needs no change), and merges re-point `lead_id` columns automatically.

-- ── Test data ────────────────────────────────────────────────────────────────
-- is_test: NULL = not decided (rules apply), 1 = test, 0 = marked "not test" by a person (sticks).
ALTER TABLE lead_revops ADD COLUMN is_test INTEGER;
ALTER TABLE lead_revops ADD COLUMN test_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_lead_revops_test ON lead_revops(is_test);

-- Browsers that are ours: an admin's browser (seen on /admin), ?test=1 first touches, internal IPs, test leads.
-- Visitor-level reports (visitors, plays, form views) leave these out unless "Include test data" is on.
CREATE TABLE IF NOT EXISTS test_visitors (
  visitor_id TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Obvious test addresses are marked at insert, before the first email or call can go out.
CREATE TRIGGER IF NOT EXISTS trg_leads_test_email AFTER INSERT ON leads
WHEN lower(NEW.email) LIKE '%@example.com' OR lower(NEW.email) LIKE '%@example.org' OR lower(NEW.email) LIKE '%@example.net'
  OR lower(NEW.email) LIKE '%+test@%'
BEGIN
  INSERT INTO lead_revops (lead_id, is_test, test_reason, updated_at) VALUES (NEW.id, 1, 'email', NEW.created_at)
  ON CONFLICT(lead_id) DO UPDATE SET is_test = COALESCE(lead_revops.is_test, 1), test_reason = COALESCE(lead_revops.test_reason, 'email');
END;

-- ── Call reviews (one row per held call) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS call_reviews (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  call_at INTEGER,
  offer_made INTEGER NOT NULL CHECK (offer_made IN (0, 1)),
  recording_url TEXT,
  qa_score INTEGER CHECK (qa_score IS NULL OR qa_score BETWEEN 1 AND 5),
  objection TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_call_reviews_lead ON call_reviews(lead_id, created_at);
CREATE INDEX IF NOT EXISTS idx_call_reviews_created ON call_reviews(created_at);

-- ── Written call plans (/plan/<token>) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS call_plans (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  body TEXT NOT NULL,                 -- JSON: first_build, why, keep, next_step, next_step_at, price, plan
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER,
  viewed_at INTEGER,                  -- first view by the lead (team views are not counted)
  last_viewed_at INTEGER,
  views INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_call_plans_lead ON call_plans(lead_id, created_at);

-- ── Escalation ladder: which rung each untouched A/B lead has reached ────────
CREATE TABLE IF NOT EXISTS lead_escalations (
  lead_id TEXT NOT NULL,
  level INTEGER NOT NULL,             -- 1 = rep pinged (5 min), 2 = managers (30 min), 3 = reassign offered (2 h)
  at INTEGER NOT NULL,
  PRIMARY KEY (lead_id, level)
);

-- ── Merged leads: old id → survivor (no personal data) ───────────────────────
CREATE TABLE IF NOT EXISTS lead_redirects (
  from_id TEXT PRIMARY KEY,
  to_id TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lead_redirects_to ON lead_redirects(to_id);

CREATE TRIGGER IF NOT EXISTS trg_leads_hq_erase AFTER DELETE ON leads
BEGIN
  DELETE FROM call_reviews WHERE lead_id = OLD.id;
  DELETE FROM call_plans WHERE lead_id = OLD.id;
  DELETE FROM lead_escalations WHERE lead_id = OLD.id;
  DELETE FROM lead_redirects WHERE to_id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_visitors_hq_erase AFTER DELETE ON visitors
BEGIN
  DELETE FROM test_visitors WHERE visitor_id = OLD.id;
END;

CREATE INDEX IF NOT EXISTS idx_events_visitor_name ON events(visitor_id, name);
