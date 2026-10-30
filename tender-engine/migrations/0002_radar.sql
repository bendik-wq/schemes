-- Project radar: public signals that come before RFQs (awards, FIDs, frame agreements, grants),
-- and TED contract-award notices for competitor intelligence.

CREATE TABLE signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,                 -- news | ted_award
  ext_id TEXT NOT NULL,                 -- url or TED publication number
  kind TEXT NOT NULL,                   -- fid | epci_award | feed_award | frame | call_off | decom | wind_grant | vessel | other
  title TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  outlet TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  buyers TEXT NOT NULL DEFAULT '[]',     -- who will buy next (contractor / operator names found in the text)
  packages TEXT NOT NULL DEFAULT '[]',   -- subcontract packages likely to follow
  window TEXT NOT NULL DEFAULT '',       -- when RFQs usually follow, in words
  relevance INTEGER NOT NULL DEFAULT 0,
  reasons TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'new',    -- new | watching | acting | dismissed
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source, ext_id)
);
CREATE INDEX signals_rank ON signals (status, relevance DESC, published_at DESC);

-- Who wins public offshore contracts, for how much, against how many bidders.
CREATE TABLE awards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ext_id TEXT NOT NULL UNIQUE,          -- TED publication number
  title TEXT NOT NULL,
  buyer TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  winners TEXT NOT NULL DEFAULT '[]',
  winner_size TEXT NOT NULL DEFAULT '[]',
  value_eur INTEGER,
  bids_received INTEGER,
  cpv TEXT NOT NULL DEFAULT '[]',
  published_at TEXT,
  url TEXT NOT NULL DEFAULT '',
  relevance INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX awards_rank ON awards (relevance DESC, published_at DESC);
