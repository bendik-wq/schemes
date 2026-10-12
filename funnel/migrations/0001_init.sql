-- Core schema: visitors, sessions, events, leads, VSL views, email queue, WhatsApp, settings, kv state.

CREATE TABLE visitors (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  ft_channel TEXT, ft_source TEXT, ft_medium TEXT, ft_campaign TEXT, ft_content TEXT, ft_term TEXT,
  ft_referrer TEXT, ft_landing TEXT, ft_click_id TEXT, ft_click_type TEXT,
  country TEXT, region TEXT, city TEXT,
  device TEXT, browser TEXT, os TEXT,
  is_bot INTEGER NOT NULL DEFAULT 0,
  sessions_count INTEGER NOT NULL DEFAULT 0,
  pageviews INTEGER NOT NULL DEFAULT 0,
  consent TEXT,
  lead_id TEXT
);
CREATE INDEX idx_visitors_lead ON visitors(lead_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  landing_path TEXT, landing_query TEXT, referrer TEXT, referrer_host TEXT,
  channel TEXT,
  utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_content TEXT, utm_term TEXT,
  click_id TEXT, click_type TEXT,
  ad_id TEXT, adset_id TEXT, placement TEXT,
  country TEXT, region TEXT, city TEXT, postal TEXT, tz TEXT, lat TEXT, lon TEXT,
  is_eu INTEGER NOT NULL DEFAULT 0, asn INTEGER, as_org TEXT, colo TEXT, tls TEXT, http_protocol TEXT,
  ip TEXT, ip_hash TEXT,
  user_agent TEXT, device TEXT, browser TEXT, os TEXT, in_app TEXT,
  accept_language TEXT,
  client_tz TEXT, screen TEXT, viewport TEXT, dpr REAL, connection TEXT,
  is_bot INTEGER NOT NULL DEFAULT 0, bot_reason TEXT,
  variant TEXT,
  pageviews INTEGER NOT NULL DEFAULT 0,
  event_count INTEGER NOT NULL DEFAULT 0,
  engaged_ms INTEGER NOT NULL DEFAULT 0,
  max_scroll INTEGER NOT NULL DEFAULT 0,
  lead_id TEXT
);
CREATE INDEX idx_sessions_visitor ON sessions(visitor_id);
CREATE INDEX idx_sessions_started ON sessions(started_at);
CREATE INDEX idx_sessions_lead ON sessions(lead_id);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  name TEXT NOT NULL,
  visitor_id TEXT,
  session_id TEXT,
  lead_id TEXT,
  path TEXT,
  source TEXT NOT NULL DEFAULT 'server',
  variant TEXT,
  is_bot INTEGER NOT NULL DEFAULT 0,
  props TEXT
);
CREATE INDEX idx_events_name_ts ON events(name, ts);
CREATE INDEX idx_events_lead ON events(lead_id);
CREATE INDEX idx_events_visitor ON events(visitor_id);
CREATE INDEX idx_events_ts ON events(ts);

CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  ref_code TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  first_name TEXT, last_name TEXT, email TEXT NOT NULL UNIQUE, phone TEXT,
  whatsapp_opt_in INTEGER NOT NULL DEFAULT 0,
  answers TEXT NOT NULL DEFAULT '{}',
  step_reached INTEGER NOT NULL DEFAULT 0,
  app_started_at INTEGER, app_completed_at INTEGER,
  score INTEGER, score_breakdown TEXT,
  tier TEXT, tier_override TEXT, route TEXT,
  closer_id TEXT,
  status TEXT NOT NULL DEFAULT 'partial',
  booked_at INTEGER, call_at INTEGER, booking_provider TEXT, booking_ref TEXT, booking_cancelled_at INTEGER,
  whatsapp_last_in_at INTEGER, whatsapp_last_out_at INTEGER,
  unsubscribed_at INTEGER,
  revenue REAL NOT NULL DEFAULT 0,
  notes TEXT,
  visitor_id TEXT,
  channel TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_content TEXT, utm_term TEXT,
  click_id TEXT, click_type TEXT, referrer TEXT,
  ft_channel TEXT, ft_source TEXT, ft_medium TEXT, ft_campaign TEXT, ft_content TEXT, ft_term TEXT, ft_referrer TEXT, ft_landing TEXT,
  landing_path TEXT, variant TEXT,
  country TEXT, region TEXT, city TEXT, device TEXT,
  fbp TEXT, fbc TEXT
);
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_created ON leads(created_at);
CREATE INDEX idx_leads_call ON leads(call_at);

CREATE TABLE vsl_views (
  visitor_id TEXT NOT NULL,
  video TEXT NOT NULL,
  lead_id TEXT,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  duration REAL NOT NULL DEFAULT 0,
  max_position REAL NOT NULL DEFAULT 0,
  watched_seconds REAL NOT NULL DEFAULT 0,
  buckets TEXT NOT NULL DEFAULT '',
  played INTEGER NOT NULL DEFAULT 0,
  unmuted INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  cta_revealed INTEGER NOT NULL DEFAULT 0,
  cta_clicked INTEGER NOT NULL DEFAULT 0,
  milestones TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (visitor_id, video)
);
CREATE INDEX idx_vsl_lead ON vsl_views(lead_id);

CREATE TABLE emails (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  sequence TEXT NOT NULL,
  step INTEGER NOT NULL,
  template TEXT NOT NULL,
  send_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  subject TEXT,
  provider_id TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  opened_at INTEGER, opens INTEGER NOT NULL DEFAULT 0,
  clicked_at INTEGER, clicks INTEGER NOT NULL DEFAULT 0,
  UNIQUE (lead_id, sequence, step)
);
CREATE INDEX idx_emails_due ON emails(status, send_at);
CREATE INDEX idx_emails_lead ON emails(lead_id);

CREATE TABLE whatsapp_messages (
  id TEXT PRIMARY KEY,
  lead_id TEXT,
  direction TEXT NOT NULL,
  phone TEXT,
  body TEXT,
  template TEXT,
  status TEXT,
  provider_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_wa_lead ON whatsapp_messages(lead_id);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE kv_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
