-- Northbid schema. One supplier workspace per deployment.

-- Supplier profile: what we can do, where, and with which approvals. Drives tender fit scoring
-- and the evidence column of every compliance matrix. Single row, id = 1.
CREATE TABLE profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  company TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  keywords TEXT NOT NULL DEFAULT '[]',       -- JSON array: "subsea", "hydraulic", "ROV tooling"
  exclude_keywords TEXT NOT NULL DEFAULT '[]',
  cpv TEXT NOT NULL DEFAULT '[]',            -- JSON array of CPV prefixes: "7652", "4291"
  countries TEXT NOT NULL DEFAULT '["NOR","GBR","DNK","NLD"]',
  certifications TEXT NOT NULL DEFAULT '[]', -- "ISO 9001:2015", "NORSOK S-006", "Achilles JQS"
  min_value_eur INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO profile (id) VALUES (1);

-- Public tenders pulled from TED (EU/EEA incl. Norway) and UK Find a Tender.
CREATE TABLE tenders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,                      -- ted | fts | manual
  ext_id TEXT NOT NULL,
  title TEXT NOT NULL,
  buyer TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  cpv TEXT NOT NULL DEFAULT '[]',
  description TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  deadline_at TEXT,
  value_eur INTEGER,
  url TEXT NOT NULL DEFAULT '',
  fit_score INTEGER NOT NULL DEFAULT 0,
  fit_reasons TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'new',        -- new | watching | pursuing | dismissed
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source, ext_id)
);
CREATE INDEX tenders_fit ON tenders (status, fit_score DESC);
CREATE INDEX tenders_deadline ON tenders (deadline_at);

-- RFQs / ITTs we are answering (from a tender above, an operator portal, or an email).
CREATE TABLE rfqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tender_id INTEGER REFERENCES tenders(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  client TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  deadline_at TEXT,
  value_eur INTEGER,
  stage TEXT NOT NULL DEFAULT 'reviewing',   -- reviewing | bidding | no_bid | submitted | won | lost
  source_text TEXT NOT NULL DEFAULT '',
  analysis TEXT,                              -- JSON: summary, bid/no-bid scorecard, clarifications, cover letter
  analysed_by TEXT,                           -- claude | rules
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX rfqs_stage ON rfqs (stage, deadline_at);

-- Compliance matrix: one row per requirement found in the RFQ.
CREATE TABLE requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rfq_id INTEGER NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  clause TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'technical', -- technical | commercial | hse | quality | documentation | legal | schedule
  mandatory INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open',        -- open | comply | partial | deviation | clarify | n/a
  response TEXT NOT NULL DEFAULT '',
  evidence_id INTEGER REFERENCES library(id) ON DELETE SET NULL,
  standards TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX requirements_rfq ON requirements (rfq_id, seq);

-- Answer library: approved, reusable answers and evidence (certificates, HSE stats, CVs, references).
CREATE TABLE library (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'technical',
  tags TEXT NOT NULL DEFAULT '[]',
  body TEXT NOT NULL,
  expires_at TEXT,                            -- certificates expire; flagged in the app
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Applications from the offer page.
CREATE TABLE applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  answers TEXT NOT NULL DEFAULT '{}',
  tier TEXT NOT NULL DEFAULT 'C',
  ip_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE feed_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  fetched INTEGER NOT NULL DEFAULT 0,
  inserted INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  ran_at TEXT NOT NULL DEFAULT (datetime('now'))
);
