-- Which reader found each requirement: claude, rules, or both. Rows found only by the second pass are flagged for review.
ALTER TABLE requirements ADD COLUMN found_by TEXT NOT NULL DEFAULT 'rules';
