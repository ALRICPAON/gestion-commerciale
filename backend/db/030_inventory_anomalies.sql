BEGIN;

CREATE TABLE IF NOT EXISTS inventory_anomalies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  department_id uuid NOT NULL,
  inventory_date date NOT NULL,
  source_type text NOT NULL DEFAULT 'inventory',
  anomaly_type text NOT NULL,
  action_type text NOT NULL DEFAULT 'reported',
  article_id uuid NULL,
  article_plu text NULL,
  article_label text NULL,
  ean text NULL,
  stock_quantity numeric(12,3) DEFAULT 0,
  sold_quantity numeric(12,3) DEFAULT 0,
  sale_unit text NULL,
  unit_sale_price_ttc numeric(12,4) DEFAULT 0,
  line_total_ttc numeric(12,2) DEFAULT 0,
  reason text NULL,
  source_row_number integer NULL,
  raw_line jsonb NULL,
  sales_document_id uuid NULL,
  created_by uuid NULL,
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_anomalies_store_department_date
  ON inventory_anomalies(store_id, department_id, inventory_date);

CREATE INDEX IF NOT EXISTS idx_inventory_anomalies_article
  ON inventory_anomalies(article_id);

CREATE INDEX IF NOT EXISTS idx_inventory_anomalies_type
  ON inventory_anomalies(anomaly_type);

COMMIT;
