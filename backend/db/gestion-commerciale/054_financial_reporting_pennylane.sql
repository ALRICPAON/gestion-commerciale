CREATE TABLE IF NOT EXISTS pennylane_trial_balance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  is_auxiliary boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'success',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'pennylane_trial_balance',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pennylane_trial_balance_snapshots_status_check
    CHECK (status IN ('success', 'failed', 'partial'))
);

CREATE UNIQUE INDEX IF NOT EXISTS pennylane_trial_balance_snapshots_period_uidx
  ON pennylane_trial_balance_snapshots (store_id, period_start, period_end, is_auxiliary, source);

CREATE INDEX IF NOT EXISTS pennylane_trial_balance_snapshots_store_fetched_idx
  ON pennylane_trial_balance_snapshots (store_id, fetched_at DESC);

CREATE TABLE IF NOT EXISTS pennylane_trial_balance_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES pennylane_trial_balance_snapshots(id) ON DELETE CASCADE,
  account_number text NOT NULL,
  formatted_account_number text,
  account_label text,
  total_debit numeric(14, 2) NOT NULL DEFAULT 0,
  total_credit numeric(14, 2) NOT NULL DEFAULT 0,
  net_balance numeric(14, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pennylane_trial_balance_lines_snapshot_idx
  ON pennylane_trial_balance_lines (snapshot_id, account_number);

CREATE TABLE IF NOT EXISTS financial_report_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid,
  account_prefix text NOT NULL,
  section_code text NOT NULL,
  subsection_code text,
  display_label text NOT NULL,
  calculation_sign integer NOT NULL DEFAULT 1,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financial_report_mappings_sign_check CHECK (calculation_sign IN (-1, 1))
);

CREATE UNIQUE INDEX IF NOT EXISTS financial_report_mappings_unique_global_idx
  ON financial_report_mappings (account_prefix, section_code, COALESCE(subsection_code, ''))
  WHERE store_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS financial_report_mappings_unique_store_idx
  ON financial_report_mappings (store_id, account_prefix, section_code, COALESCE(subsection_code, ''))
  WHERE store_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS financial_report_mappings_lookup_idx
  ON financial_report_mappings (store_id, is_active, account_prefix);

CREATE TABLE IF NOT EXISTS financial_report_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL,
  processed_count integer NOT NULL DEFAULT 0,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT financial_report_sync_logs_status_check
    CHECK (status IN ('started', 'success', 'failed', 'partial'))
);

CREATE INDEX IF NOT EXISTS financial_report_sync_logs_store_period_idx
  ON financial_report_sync_logs (store_id, period_start, period_end, started_at DESC);

INSERT INTO financial_report_mappings (
  store_id, account_prefix, section_code, subsection_code, display_label, calculation_sign, display_order, is_active
)
VALUES
  (NULL, '70', 'operating_revenue', 'revenue', 'Chiffre d affaires', 1, 10, true),
  (NULL, '71', 'operating_revenue', 'stocked_production', 'Production stockee', 1, 20, true),
  (NULL, '72', 'operating_revenue', 'capitalized_production', 'Production immobilisee', 1, 30, true),
  (NULL, '74', 'operating_revenue', 'subsidies', 'Subventions d exploitation', 1, 40, true),
  (NULL, '75', 'operating_revenue', 'other_operating_income', 'Autres produits de gestion courante', 1, 50, true),
  (NULL, '607', 'operating_expenses', 'goods_purchases', 'Achats de marchandises', -1, 90, true),
  (NULL, '6037', 'operating_expenses', 'stock_variation', 'Variation de stock marchandises', -1, 95, true),
  (NULL, '603', 'operating_expenses', 'stock_variation', 'Variation de stocks', -1, 96, true),
  (NULL, '60', 'operating_expenses', 'purchases', 'Autres achats', -1, 100, true),
  (NULL, '624', 'operating_expenses', 'transport', 'Transport', -1, 108, true),
  (NULL, '61', 'operating_expenses', 'external_services', 'Services exterieurs', -1, 110, true),
  (NULL, '6226', 'operating_expenses', 'other_external_services', 'Honoraires', -1, 118, true),
  (NULL, '62', 'operating_expenses', 'other_external_services', 'Autres services', -1, 120, true),
  (NULL, '625', 'operating_expenses', 'other_external_services', 'Deplacements, missions et receptions', -1, 122, true),
  (NULL, '63', 'operating_expenses', 'taxes', 'Impots et taxes', -1, 130, true),
  (NULL, '645', 'operating_expenses', 'social_charges', 'Charges sociales', -1, 138, true),
  (NULL, '641', 'operating_expenses', 'wages', 'Salaires et appointements', -1, 139, true),
  (NULL, '64', 'operating_expenses', 'wages', 'Salaires', -1, 140, true),
  (NULL, '65', 'operating_expenses', 'other_operating_expenses', 'Autres charges de gestion courante', -1, 150, true),
  (NULL, '68', 'operating_expenses', 'depreciation', 'Dotations aux amortissements et provisions', -1, 160, true),
  (NULL, '66', 'financial_result', 'financial_expenses', 'Charges financieres', -1, 210, true),
  (NULL, '76', 'financial_result', 'financial_income', 'Produits financiers', 1, 220, true),
  (NULL, '67', 'exceptional_result', 'exceptional_expenses', 'Charges exceptionnelles', -1, 310, true),
  (NULL, '77', 'exceptional_result', 'exceptional_income', 'Produits exceptionnels', 1, 320, true),
  (NULL, '78', 'operating_revenue', 'reversals', 'Reprises sur amortissements, depreciations et provisions', 1, 330, true),
  (NULL, '79', 'operating_revenue', 'charge_transfers', 'Transferts de charges', 1, 340, true),
  (NULL, '69', 'income_tax', 'income_tax', 'Participation et impot sur les benefices', -1, 410, true)
ON CONFLICT DO NOTHING;
