ALTER TABLE sessions ADD COLUMN lander TEXT;
ALTER TABLE leads ADD COLUMN lander TEXT;
ALTER TABLE leads ADD COLUMN ft_lander TEXT;
CREATE INDEX idx_sessions_lander ON sessions(lander);
