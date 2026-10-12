CREATE TABLE calendly_bookings (
  invitee_uri TEXT PRIMARY KEY,
  event_uri TEXT,
  lead_id TEXT,
  match_kind TEXT,
  name TEXT,
  email TEXT,
  event_name TEXT,
  start_at INTEGER,
  status TEXT,
  no_show INTEGER NOT NULL DEFAULT 0,
  rescheduled INTEGER NOT NULL DEFAULT 0,
  host_email TEXT,
  answers TEXT,
  tracking TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_cb_lead ON calendly_bookings(lead_id);
CREATE INDEX idx_cb_email ON calendly_bookings(email);
CREATE INDEX idx_cb_start ON calendly_bookings(start_at);
