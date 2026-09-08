BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE pennylane_supplier_invoices
  ADD COLUMN IF NOT EXISTS supplier_control_status text;

UPDATE pennylane_supplier_invoices
SET supplier_control_status = CASE
  WHEN paid = true OR LOWER(COALESCE(payment_status, '')) = 'paid' OR LOWER(COALESCE(payment_status, '')) LIKE 'paid\_%' ESCAPE '\' THEN 'paye'
  WHEN LOWER(COALESCE(payment_status, '')) = 'to_be_paid' OR alta_business_status = 'validee_a_payer' THEN 'valide_a_payer'
  WHEN alta_business_status = 'litige' OR alta_business_status = 'refusee' THEN 'litige'
  WHEN alta_business_status = 'conforme' THEN 'conforme'
  WHEN alta_business_status IN ('ecart_prix', 'ecart_quantite', 'ecart_tva') THEN 'ecart'
  WHEN alta_business_status IN ('analyse_automatique', 'en_controle', 'article_inconnu', 'controle_manuel') THEN 'a_controler'
  ELSE 'a_rapprocher'
END
WHERE supplier_control_status IS NULL;

ALTER TABLE pennylane_supplier_invoices
  ALTER COLUMN supplier_control_status SET DEFAULT 'a_rapprocher',
  ALTER COLUMN supplier_control_status SET NOT NULL,
  DROP CONSTRAINT IF EXISTS chk_pennylane_supplier_invoices_supplier_control_status,
  ADD CONSTRAINT chk_pennylane_supplier_invoices_supplier_control_status
    CHECK (supplier_control_status IN (
      'a_rapprocher',
      'a_controler',
      'ecart',
      'avoir_attendu',
      'conforme',
      'valide_a_payer',
      'paye',
      'litige'
    ));

CREATE TABLE IF NOT EXISTS supplier_control_document_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  pennylane_supplier_invoice_id uuid NOT NULL REFERENCES pennylane_supplier_invoices(id) ON DELETE CASCADE,
  purchase_id uuid REFERENCES purchases(id) ON DELETE SET NULL,
  purchase_line_id uuid REFERENCES purchase_lines(id) ON DELETE SET NULL,
  link_type text NOT NULL DEFAULT 'invoice_match',
  match_status text NOT NULL DEFAULT 'proposed',
  amount_difference numeric(14,4) NOT NULL DEFAULT 0,
  quantity_difference numeric(14,4) NOT NULL DEFAULT 0,
  price_difference numeric(14,6) NOT NULL DEFAULT 0,
  vat_difference numeric(14,4) NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'manual',
  matching_method text,
  confidence numeric(6,2),
  legacy_supplier_invoice_id uuid REFERENCES supplier_invoices(id) ON DELETE SET NULL,
  legacy_supplier_invoice_match_id uuid REFERENCES supplier_invoice_matches(id) ON DELETE SET NULL,
  validated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  validated_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT chk_supplier_control_document_links_type CHECK (
    link_type IN (
      'invoice_match',
      'credit_note_source',
      'credit_note_application',
      'expected_credit_note'
    )
  ),
  CONSTRAINT chk_supplier_control_document_links_status CHECK (
    match_status IN (
      'proposed',
      'matched',
      'difference',
      'validated',
      'rejected',
      'removed'
    )
  ),
  CONSTRAINT chk_supplier_control_document_links_confidence CHECK (
    confidence IS NULL OR (confidence >= 0 AND confidence <= 100)
  ),
  CONSTRAINT chk_supplier_control_document_links_store_scope CHECK (
    store_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_control_links_purchase
  ON supplier_control_document_links(store_id, pennylane_supplier_invoice_id, purchase_id, link_type)
  WHERE purchase_id IS NOT NULL AND purchase_line_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_control_links_purchase_line
  ON supplier_control_document_links(store_id, pennylane_supplier_invoice_id, purchase_id, purchase_line_id, link_type)
  WHERE purchase_id IS NOT NULL AND purchase_line_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_control_links_invoice
  ON supplier_control_document_links(pennylane_supplier_invoice_id, match_status);

CREATE INDEX IF NOT EXISTS idx_supplier_control_links_purchase
  ON supplier_control_document_links(store_id, purchase_id, purchase_line_id);

CREATE INDEX IF NOT EXISTS idx_supplier_control_links_legacy_invoice
  ON supplier_control_document_links(legacy_supplier_invoice_id);

CREATE TABLE IF NOT EXISTS supplier_control_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  pennylane_supplier_invoice_id uuid NOT NULL REFERENCES pennylane_supplier_invoices(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_key text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_supplier_control_events_type CHECK (
    event_type IN (
      'pennylane_sync',
      'automatic_analysis',
      'match_added',
      'match_removed',
      'validation',
      'difference',
      'litigation',
      'expected_credit_note',
      'credit_note_linked',
      'pennylane_sync_error',
      'pennylane_retry',
      'legacy_backfill',
      'migration_issue'
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_control_events_key
  ON supplier_control_events(store_id, pennylane_supplier_invoice_id, event_key)
  WHERE event_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_control_events_invoice
  ON supplier_control_events(pennylane_supplier_invoice_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_supplier_control_events_type
  ON supplier_control_events(store_id, event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS supplier_control_migration_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  issue_type text NOT NULL,
  legacy_supplier_invoice_id uuid REFERENCES supplier_invoices(id) ON DELETE SET NULL,
  legacy_credit_note_application_id uuid REFERENCES supplier_credit_note_applications(id) ON DELETE SET NULL,
  legacy_supplier_return_id uuid REFERENCES supplier_credit_note_returns(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_control_migration_issues_legacy_invoice
  ON supplier_control_migration_issues(store_id, issue_type, legacy_supplier_invoice_id)
  WHERE legacy_supplier_invoice_id IS NOT NULL
    AND legacy_credit_note_application_id IS NULL
    AND legacy_supplier_return_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_control_migration_issues_credit_application
  ON supplier_control_migration_issues(store_id, issue_type, legacy_credit_note_application_id)
  WHERE legacy_credit_note_application_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_supplier_control_migration_issues_supplier_return
  ON supplier_control_migration_issues(store_id, issue_type, legacy_supplier_return_id)
  WHERE legacy_supplier_return_id IS NOT NULL;

CREATE OR REPLACE FUNCTION set_supplier_control_links_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_supplier_control_links_updated_at ON supplier_control_document_links;
CREATE TRIGGER trg_supplier_control_links_updated_at
BEFORE UPDATE ON supplier_control_document_links
FOR EACH ROW
EXECUTE FUNCTION set_supplier_control_links_updated_at();

WITH legacy_bridge AS (
  SELECT DISTINCT ON (si.id)
    si.id AS legacy_supplier_invoice_id,
    psi.id AS pennylane_invoice_id,
    si.store_id,
    si.status,
    si.match_status,
    si.validated_by,
    si.validated_at
  FROM supplier_invoices si
  JOIN pennylane_supplier_invoices psi
    ON psi.store_id = si.store_id
   AND (
      NULLIF(si.pennylane_payload->>'pennylane_supplier_invoice_id', '') = psi.pennylane_supplier_invoice_id
      OR (
        NULLIF(si.pennylane_payload->>'pennylane_supplier_invoice_id', '') IS NULL
        AND si.supplier_id = psi.supplier_id
        AND si.invoice_number = psi.invoice_number
        AND NOT EXISTS (
          SELECT 1
          FROM pennylane_supplier_invoices psi_dup
          WHERE psi_dup.store_id = si.store_id
            AND psi_dup.supplier_id = si.supplier_id
            AND psi_dup.invoice_number = si.invoice_number
            AND psi_dup.id <> psi.id
        )
      )
   )
  WHERE psi.pennylane_deleted_at IS NULL
  ORDER BY si.id, psi.last_synced_at DESC NULLS LAST, psi.created_at DESC
), historical_matches AS (
  SELECT
    lb.store_id,
    lb.pennylane_invoice_id,
    sim.id AS legacy_match_id,
    sim.purchase_id,
    sim.purchase_line_id,
    CASE
      WHEN sim.match_status IN ('matched', 'manual_validated') THEN 'matched'
      WHEN sim.match_status = 'difference' THEN 'difference'
      ELSE 'proposed'
    END AS canonical_match_status,
    COALESCE(sim.amount_difference, 0) AS amount_difference,
    COALESCE(sim.quantity_difference, 0) AS quantity_difference,
    COALESCE(sim.price_difference, 0) AS price_difference,
    lb.legacy_supplier_invoice_id,
    CASE
      WHEN lb.status IN ('invoice_validated', 'cost_adjusted', 'sent_to_pennylane')
        THEN lb.validated_by
      ELSE NULL
    END AS validated_by,
    CASE
      WHEN lb.status IN ('invoice_validated', 'cost_adjusted', 'sent_to_pennylane')
        THEN lb.validated_at
      ELSE NULL
    END AS validated_at,
    lb.validated_by AS created_by,
    jsonb_build_object(
      'source_table', 'supplier_invoice_matches',
      'legacy_supplier_invoice_id', lb.legacy_supplier_invoice_id,
      'legacy_match_status', sim.match_status,
      'legacy_difference_type', sim.difference_type,
      'legacy_notes', sim.notes
    ) AS raw_payload
  FROM legacy_bridge lb
  JOIN supplier_invoice_matches sim
    ON sim.supplier_invoice_id = lb.legacy_supplier_invoice_id
   AND sim.store_id = lb.store_id
  WHERE sim.purchase_id IS NOT NULL
)
INSERT INTO supplier_control_document_links(
  store_id,
  pennylane_supplier_invoice_id,
  purchase_id,
  purchase_line_id,
  link_type,
  match_status,
  amount_difference,
  quantity_difference,
  price_difference,
  source,
  matching_method,
  legacy_supplier_invoice_id,
  legacy_supplier_invoice_match_id,
  validated_by,
  validated_at,
  created_by,
  raw_payload
)
SELECT
  store_id,
  pennylane_invoice_id,
  purchase_id,
  purchase_line_id,
  'invoice_match',
  canonical_match_status,
  amount_difference,
  quantity_difference,
  price_difference,
  'legacy_backfill',
  'supplier_invoice_matches',
  legacy_supplier_invoice_id,
  legacy_match_id,
  validated_by,
  validated_at,
  created_by,
  raw_payload
FROM historical_matches
ON CONFLICT DO NOTHING;

WITH legacy_bridge AS (
  SELECT DISTINCT ON (si.id)
    si.id AS legacy_supplier_invoice_id,
    psi.id AS pennylane_invoice_id,
    si.store_id,
    si.status,
    si.match_status,
    si.validated_by,
    si.validated_at,
    si.pennylane_status
  FROM supplier_invoices si
  JOIN pennylane_supplier_invoices psi
    ON psi.store_id = si.store_id
   AND (
      NULLIF(si.pennylane_payload->>'pennylane_supplier_invoice_id', '') = psi.pennylane_supplier_invoice_id
      OR (
        NULLIF(si.pennylane_payload->>'pennylane_supplier_invoice_id', '') IS NULL
        AND si.supplier_id = psi.supplier_id
        AND si.invoice_number = psi.invoice_number
        AND NOT EXISTS (
          SELECT 1
          FROM pennylane_supplier_invoices psi_dup
          WHERE psi_dup.store_id = si.store_id
            AND psi_dup.supplier_id = si.supplier_id
            AND psi_dup.invoice_number = si.invoice_number
            AND psi_dup.id <> psi.id
        )
      )
   )
  WHERE psi.pennylane_deleted_at IS NULL
  ORDER BY si.id, psi.last_synced_at DESC NULLS LAST, psi.created_at DESC
)
INSERT INTO supplier_control_events(
  store_id,
  pennylane_supplier_invoice_id,
  event_type,
  event_key,
  payload,
  created_by,
  created_at
)
SELECT
  store_id,
  pennylane_invoice_id,
  'legacy_backfill',
  'legacy_supplier_invoice:' || legacy_supplier_invoice_id::text,
  jsonb_build_object(
    'legacy_supplier_invoice_id', legacy_supplier_invoice_id,
    'legacy_status', status,
    'legacy_match_status', match_status,
    'legacy_pennylane_status', pennylane_status,
    'validated_at', validated_at
  ),
  validated_by,
  COALESCE(validated_at, now())
FROM legacy_bridge
ON CONFLICT DO NOTHING;

WITH legacy_bridge AS (
  SELECT DISTINCT ON (si.id)
    si.id AS legacy_supplier_invoice_id,
    psi.id AS pennylane_invoice_id,
    si.store_id
  FROM supplier_invoices si
  JOIN pennylane_supplier_invoices psi
    ON psi.store_id = si.store_id
   AND (
      NULLIF(si.pennylane_payload->>'pennylane_supplier_invoice_id', '') = psi.pennylane_supplier_invoice_id
      OR (
        NULLIF(si.pennylane_payload->>'pennylane_supplier_invoice_id', '') IS NULL
        AND si.supplier_id = psi.supplier_id
        AND si.invoice_number = psi.invoice_number
        AND NOT EXISTS (
          SELECT 1
          FROM pennylane_supplier_invoices psi_dup
          WHERE psi_dup.store_id = si.store_id
            AND psi_dup.supplier_id = si.supplier_id
            AND psi_dup.invoice_number = si.invoice_number
            AND psi_dup.id <> psi.id
        )
      )
   )
  WHERE psi.pennylane_deleted_at IS NULL
  ORDER BY si.id, psi.last_synced_at DESC NULLS LAST, psi.created_at DESC
)
INSERT INTO supplier_control_events(
  store_id,
  pennylane_supplier_invoice_id,
  event_type,
  event_key,
  payload,
  created_by,
  created_at
)
SELECT
  lb.store_id,
  lb.pennylane_invoice_id,
  'credit_note_linked',
  'legacy_credit_note_application:' || scna.id::text,
  jsonb_build_object(
    'legacy_credit_note_application_id', scna.id,
    'legacy_credit_note_invoice_id', scna.credit_note_invoice_id,
    'source_supplier_invoice_id', scna.source_supplier_invoice_id,
    'source_purchase_id', scna.source_purchase_id,
    'application_type', scna.application_type,
    'amount_ex_vat', scna.amount_ex_vat
  ),
  scna.created_by,
  scna.created_at
FROM supplier_credit_note_applications scna
JOIN legacy_bridge lb
  ON lb.legacy_supplier_invoice_id = scna.credit_note_invoice_id
ON CONFLICT DO NOTHING;

WITH legacy_bridge AS (
  SELECT DISTINCT ON (si.id)
    si.id AS legacy_supplier_invoice_id,
    psi.id AS pennylane_invoice_id,
    si.store_id
  FROM supplier_invoices si
  JOIN pennylane_supplier_invoices psi
    ON psi.store_id = si.store_id
   AND (
      NULLIF(si.pennylane_payload->>'pennylane_supplier_invoice_id', '') = psi.pennylane_supplier_invoice_id
      OR (
        NULLIF(si.pennylane_payload->>'pennylane_supplier_invoice_id', '') IS NULL
        AND si.supplier_id = psi.supplier_id
        AND si.invoice_number = psi.invoice_number
        AND NOT EXISTS (
          SELECT 1
          FROM pennylane_supplier_invoices psi_dup
          WHERE psi_dup.store_id = si.store_id
            AND psi_dup.supplier_id = si.supplier_id
            AND psi_dup.invoice_number = si.invoice_number
            AND psi_dup.id <> psi.id
        )
      )
   )
  WHERE psi.pennylane_deleted_at IS NULL
  ORDER BY si.id, psi.last_synced_at DESC NULLS LAST, psi.created_at DESC
)
INSERT INTO supplier_control_events(
  store_id,
  pennylane_supplier_invoice_id,
  event_type,
  event_key,
  payload,
  created_by,
  created_at
)
SELECT
  lb.store_id,
  lb.pennylane_invoice_id,
  'credit_note_linked',
  'legacy_supplier_return:' || scnr.id::text,
  jsonb_build_object(
    'legacy_supplier_return_id', scnr.id,
    'legacy_credit_note_invoice_id', scnr.credit_note_invoice_id,
    'purchase_id', scnr.purchase_id,
    'purchase_line_id', scnr.purchase_line_id,
    'lot_id', scnr.lot_id,
    'article_id', scnr.article_id,
    'quantity', scnr.quantity,
    'movement_id', scnr.movement_id
  ),
  scnr.created_by,
  scnr.created_at
FROM supplier_credit_note_returns scnr
JOIN legacy_bridge lb
  ON lb.legacy_supplier_invoice_id = scnr.credit_note_invoice_id
ON CONFLICT DO NOTHING;

WITH bridged_invoices AS (
  SELECT DISTINCT si.id
  FROM supplier_invoices si
  JOIN pennylane_supplier_invoices psi
    ON psi.store_id = si.store_id
   AND (
      NULLIF(si.pennylane_payload->>'pennylane_supplier_invoice_id', '') = psi.pennylane_supplier_invoice_id
      OR (
        NULLIF(si.pennylane_payload->>'pennylane_supplier_invoice_id', '') IS NULL
        AND si.supplier_id = psi.supplier_id
        AND si.invoice_number = psi.invoice_number
        AND NOT EXISTS (
          SELECT 1
          FROM pennylane_supplier_invoices psi_dup
          WHERE psi_dup.store_id = si.store_id
            AND psi_dup.supplier_id = si.supplier_id
            AND psi_dup.invoice_number = si.invoice_number
            AND psi_dup.id <> psi.id
        )
      )
   )
  WHERE psi.pennylane_deleted_at IS NULL
)
INSERT INTO supplier_control_migration_issues(
  store_id,
  issue_type,
  legacy_supplier_invoice_id,
  details
)
SELECT
  si.store_id,
  'legacy_supplier_invoice_without_canonical_pennylane_document',
  si.id,
  jsonb_build_object(
    'invoice_number', si.invoice_number,
    'supplier_id', si.supplier_id,
    'document_type', si.document_type,
    'status', si.status,
    'pennylane_payload_id', NULLIF(si.pennylane_payload->>'pennylane_supplier_invoice_id', '')
  )
FROM supplier_invoices si
WHERE si.id NOT IN (SELECT id FROM bridged_invoices)
  AND (
    NULLIF(si.pennylane_payload->>'pennylane_supplier_invoice_id', '') IS NOT NULL
    OR si.pennylane_status IN ('to_be_paid', 'paid', 'sent_to_pennylane')
  )
ON CONFLICT DO NOTHING;

WITH bridged_credit_notes AS (
  SELECT DISTINCT si.id
  FROM supplier_invoices si
  JOIN pennylane_supplier_invoices psi
    ON psi.store_id = si.store_id
   AND (
      NULLIF(si.pennylane_payload->>'pennylane_supplier_invoice_id', '') = psi.pennylane_supplier_invoice_id
      OR (
        NULLIF(si.pennylane_payload->>'pennylane_supplier_invoice_id', '') IS NULL
        AND si.supplier_id = psi.supplier_id
        AND si.invoice_number = psi.invoice_number
        AND NOT EXISTS (
          SELECT 1
          FROM pennylane_supplier_invoices psi_dup
          WHERE psi_dup.store_id = si.store_id
            AND psi_dup.supplier_id = si.supplier_id
            AND psi_dup.invoice_number = si.invoice_number
            AND psi_dup.id <> psi.id
        )
      )
   )
  WHERE si.document_type = 'credit_note'
    AND psi.pennylane_deleted_at IS NULL
)
INSERT INTO supplier_control_migration_issues(
  store_id,
  issue_type,
  legacy_credit_note_application_id,
  details
)
SELECT
  scna.store_id,
  'legacy_credit_note_application_without_canonical_pennylane_document',
  scna.id,
  jsonb_build_object(
    'credit_note_invoice_id', scna.credit_note_invoice_id,
    'source_supplier_invoice_id', scna.source_supplier_invoice_id,
    'source_purchase_id', scna.source_purchase_id,
    'application_type', scna.application_type,
    'amount_ex_vat', scna.amount_ex_vat
  )
FROM supplier_credit_note_applications scna
WHERE scna.credit_note_invoice_id NOT IN (SELECT id FROM bridged_credit_notes)
ON CONFLICT DO NOTHING;

WITH bridged_credit_notes AS (
  SELECT DISTINCT si.id
  FROM supplier_invoices si
  JOIN pennylane_supplier_invoices psi
    ON psi.store_id = si.store_id
   AND (
      NULLIF(si.pennylane_payload->>'pennylane_supplier_invoice_id', '') = psi.pennylane_supplier_invoice_id
      OR (
        NULLIF(si.pennylane_payload->>'pennylane_supplier_invoice_id', '') IS NULL
        AND si.supplier_id = psi.supplier_id
        AND si.invoice_number = psi.invoice_number
        AND NOT EXISTS (
          SELECT 1
          FROM pennylane_supplier_invoices psi_dup
          WHERE psi_dup.store_id = si.store_id
            AND psi_dup.supplier_id = si.supplier_id
            AND psi_dup.invoice_number = si.invoice_number
            AND psi_dup.id <> psi.id
        )
      )
   )
  WHERE si.document_type = 'credit_note'
    AND psi.pennylane_deleted_at IS NULL
)
INSERT INTO supplier_control_migration_issues(
  store_id,
  issue_type,
  legacy_supplier_return_id,
  details
)
SELECT
  scnr.store_id,
  'legacy_supplier_return_without_canonical_pennylane_document',
  scnr.id,
  jsonb_build_object(
    'credit_note_invoice_id', scnr.credit_note_invoice_id,
    'purchase_id', scnr.purchase_id,
    'purchase_line_id', scnr.purchase_line_id,
    'lot_id', scnr.lot_id,
    'article_id', scnr.article_id,
    'quantity', scnr.quantity,
    'movement_id', scnr.movement_id
  )
FROM supplier_credit_note_returns scnr
WHERE scnr.credit_note_invoice_id NOT IN (SELECT id FROM bridged_credit_notes)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE VIEW supplier_control_document_summary AS
SELECT
  psi.id AS pennylane_supplier_invoice_id,
  psi.store_id,
  psi.pennylane_supplier_invoice_id AS pennylane_external_invoice_id,
  psi.supplier_id,
  psi.invoice_number,
  psi.invoice_date,
  psi.due_date,
  psi.document_type,
  psi.amount_ex_vat,
  psi.amount_vat,
  psi.amount_inc_vat,
  psi.payment_status,
  psi.paid,
  psi.alta_business_status,
  psi.supplier_control_status,
  COUNT(DISTINCT scl.purchase_id) FILTER (WHERE scl.purchase_id IS NOT NULL AND scl.match_status <> 'removed') AS linked_purchase_count,
  COUNT(scl.id) FILTER (WHERE scl.match_status = 'difference') AS difference_count,
  COALESCE(SUM(scl.amount_difference) FILTER (WHERE scl.match_status <> 'removed'), 0) AS amount_difference_total,
  MAX(scl.validated_at) AS last_validated_at
FROM pennylane_supplier_invoices psi
LEFT JOIN supplier_control_document_links scl
  ON scl.pennylane_supplier_invoice_id = psi.id
 AND scl.store_id = psi.store_id
GROUP BY psi.id;

COMMIT;
