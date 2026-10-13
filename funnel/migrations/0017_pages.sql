-- Attendance confirmation ("I'll be there" on /breakout, in the 24 h reminder and the 2 h nudge).
-- attendance_call_at is the call time that was confirmed, so a reschedule needs a fresh confirmation.
ALTER TABLE leads ADD COLUMN attendance_confirmed_at INTEGER;
ALTER TABLE leads ADD COLUMN attendance_call_at INTEGER;
