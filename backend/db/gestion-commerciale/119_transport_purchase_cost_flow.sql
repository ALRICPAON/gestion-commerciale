BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS transport_delivery_note_id uuid,
  ADD COLUMN IF NOT EXISTS transport_shipment_id uuid,
  ADD COLUMN IF NOT EXISTS source_kind text,
  ADD COLUMN IF NOT EXISTS source_reference text,
  ADD COLUMN IF NOT EXISTS source_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE transport_delivery_notes
  ADD COLUMN IF NOT EXISTS purchase_id uuid,
  ADD COLUMN IF NOT EXISTS real_transport_cost_per_kg_ht numeric(14,4);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_purchases_transport_delivery_note'
      AND conrelid = 'purchases'::regclass
  ) THEN
    ALTER TABLE purchases
      ADD CONSTRAINT fk_purchases_transport_delivery_note
      FOREIGN KEY (transport_delivery_note_id) REFERENCES transport_delivery_notes(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_purchases_transport_shipment'
      AND conrelid = 'purchases'::regclass
  ) THEN
    ALTER TABLE purchases
      ADD CONSTRAINT fk_purchases_transport_shipment
      FOREIGN KEY (transport_shipment_id) REFERENCES transport_shipments(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_transport_delivery_notes_purchase'
      AND conrelid = 'transport_delivery_notes'::regclass
  ) THEN
    ALTER TABLE transport_delivery_notes
      ADD CONSTRAINT fk_transport_delivery_notes_purchase
      FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_purchases_transport_delivery_note
  ON purchases(store_id, transport_delivery_note_id)
  WHERE transport_delivery_note_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transport_delivery_notes_purchase
  ON transport_delivery_notes(store_id, purchase_id)
  WHERE purchase_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS transport_cost_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  transport_delivery_note_id uuid NOT NULL REFERENCES transport_delivery_notes(id) ON DELETE CASCADE,
  transport_purchase_id uuid REFERENCES purchases(id) ON DELETE SET NULL,
  target_purchase_id uuid REFERENCES purchases(id) ON DELETE SET NULL,
  target_purchase_line_id uuid REFERENCES purchase_lines(id) ON DELETE CASCADE,
  target_sales_document_id uuid REFERENCES sales_documents(id) ON DELETE SET NULL,
  target_sales_line_id uuid REFERENCES sales_lines(id) ON DELETE CASCADE,
  allocation_scope text NOT NULL,
  allocated_weight_kg numeric(14,3) NOT NULL DEFAULT 0,
  allocated_amount_ht numeric(14,4) NOT NULL DEFAULT 0,
  unit_transport_cost_ht numeric(14,4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_transport_cost_allocations_scope CHECK (allocation_scope IN ('purchase_line', 'sales_line'))
);

CREATE INDEX IF NOT EXISTS idx_transport_cost_allocations_delivery_note
  ON transport_cost_allocations(store_id, transport_delivery_note_id);

CREATE INDEX IF NOT EXISTS idx_transport_cost_allocations_sales_line
  ON transport_cost_allocations(store_id, target_sales_line_id)
  WHERE target_sales_line_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transport_cost_allocations_purchase_line
  ON transport_cost_allocations(store_id, target_purchase_line_id)
  WHERE target_purchase_line_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_transport_cost_allocations_sales_line
  ON transport_cost_allocations(transport_delivery_note_id, target_sales_line_id)
  WHERE target_sales_line_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_transport_cost_allocations_purchase_line
  ON transport_cost_allocations(transport_delivery_note_id, target_purchase_line_id)
  WHERE target_purchase_line_id IS NOT NULL;

COMMIT;
