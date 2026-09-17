ALTER TABLE client_logistics_services
  ADD COLUMN IF NOT EXISTS provider_supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_client_logistics_services_provider
  ON client_logistics_services(store_id, provider_supplier_id)
  WHERE is_active = true AND provider_supplier_id IS NOT NULL;
