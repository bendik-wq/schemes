ALTER TABLE leads ADD COLUMN booking_join_url TEXT;
ALTER TABLE leads ADD COLUMN booking_reschedule_url TEXT;
ALTER TABLE leads ADD COLUMN booking_cancel_url TEXT;
ALTER TABLE leads ADD COLUMN booking_host_email TEXT;
ALTER TABLE leads ADD COLUMN booking_answers TEXT;
ALTER TABLE leads ADD COLUMN booking_source TEXT NOT NULL DEFAULT 'funnel';
