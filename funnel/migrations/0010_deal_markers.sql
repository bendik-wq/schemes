ALTER TABLE leads ADD COLUMN industry TEXT;
ALTER TABLE leads ADD COLUMN revenue_band TEXT;
ALTER TABLE leads ADD COLUMN budget_band TEXT;
ALTER TABLE leads ADD COLUMN willing_to_invest TEXT;
ALTER TABLE leads ADD COLUMN qual_source TEXT;
ALTER TABLE leads ADD COLUMN qual_flags TEXT;
ALTER TABLE leads ADD COLUMN temperature TEXT;
ALTER TABLE leads ADD COLUMN objection TEXT;
ALTER TABLE leads ADD COLUMN follow_up_at INTEGER;
ALTER TABLE leads ADD COLUMN decision_maker TEXT;
ALTER TABLE leads ADD COLUMN fit_rating INTEGER;
ALTER TABLE leads ADD COLUMN offer TEXT;
ALTER TABLE leads ADD COLUMN payment_plan TEXT;
ALTER TABLE leads ADD COLUMN installments_total INTEGER;
ALTER TABLE leads ADD COLUMN next_payment_at INTEGER;
ALTER TABLE leads ADD COLUMN contract_signed_at INTEGER;
ALTER TABLE leads ADD COLUMN refunded_at INTEGER;
ALTER TABLE leads ADD COLUMN refund_amount REAL;
ALTER TABLE leads ADD COLUMN loi_signed_at INTEGER;
ALTER TABLE leads ADD COLUMN target_business TEXT;

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  amount REAL NOT NULL,
  paid_at INTEGER NOT NULL,
  method TEXT,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_payments_lead ON payments(lead_id);
CREATE INDEX idx_payments_paid ON payments(paid_at);
