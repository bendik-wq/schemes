CREATE TABLE tracked_links (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other',
  video_id TEXT, video_title TEXT, thumbnail TEXT,
  placement TEXT,
  dest_path TEXT NOT NULL DEFAULT '/',
  utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_content TEXT,
  clicks INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);
