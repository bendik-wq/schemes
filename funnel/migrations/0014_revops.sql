-- Revenue operations, part 1: ad spend, ad-level first touch, alerts.

-- Daily spend per ad, pulled from Meta Insights (hourly) or imported as CSV for other platforms.
CREATE TABLE IF NOT EXISTS ad_spend (
  platform TEXT NOT NULL,
  date TEXT NOT NULL,                -- YYYY-MM-DD in the ad account's day
  ad_id TEXT NOT NULL,
  ad_name TEXT,
  adset_id TEXT,
  adset_name TEXT,
  campaign_id TEXT,
  campaign_name TEXT,
  spend REAL NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  link_clicks INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'api',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (platform, date, ad_id)
);
CREATE INDEX IF NOT EXISTS idx_ad_spend_date ON ad_spend(date);
CREATE INDEX IF NOT EXISTS idx_sessions_ad ON sessions(ad_id);

-- Per-lead revenue-ops fields. A side table because D1 caps a table at 100 columns and leads is close.
-- ft_*: the ad a lead first arrived from (their earliest session that carried an ad id).
CREATE TABLE IF NOT EXISTS lead_revops (
  lead_id TEXT PRIMARY KEY,
  ft_ad_id TEXT,
  ft_adset_id TEXT,
  ft_placement TEXT,
  p_win REAL,                         -- calibrated P(won) from the active scoring model
  noshow_risk REAL,                   -- 0..1 for the next booked call
  noshow_reasons TEXT,                -- JSON array of reason keys
  noshow_scored_at INTEGER,
  email_status TEXT,                  -- NULL ok · bounced · complained
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lead_revops_ad ON lead_revops(ft_ad_id);

-- Filled at insert from the visitor's sessions; the hourly cron backfills leads linked later.
CREATE TRIGGER IF NOT EXISTS trg_leads_ft_ad AFTER INSERT ON leads
WHEN NEW.visitor_id IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO lead_revops (lead_id, ft_ad_id, ft_adset_id, ft_placement, updated_at)
  SELECT NEW.id, s.ad_id, s.adset_id, s.placement, NEW.created_at FROM sessions s
  WHERE s.visitor_id = NEW.visitor_id AND s.ad_id IS NOT NULL AND s.ad_id != '' ORDER BY s.started_at LIMIT 1;
END;

-- Anomaly alerts. One open row per rule at a time; resolved rows are history.
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  rule TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warn',
  opened_at INTEGER NOT NULL,
  resolved_at INTEGER,
  last_value REAL,
  baseline REAL,
  detail TEXT,
  checked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_alerts_open ON alerts(rule, resolved_at);
CREATE INDEX IF NOT EXISTS idx_alerts_opened ON alerts(opened_at);
