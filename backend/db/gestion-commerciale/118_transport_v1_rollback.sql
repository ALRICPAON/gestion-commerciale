ALTER TABLE supplier_transport_settings DROP CONSTRAINT IF EXISTS fk_supplier_transport_chain;
ALTER TABLE clients DROP CONSTRAINT IF EXISTS fk_clients_sale_transport_chain;

DROP TABLE IF EXISTS transport_delivery_notes;
DROP TABLE IF EXISTS transport_shipment_documents;
DROP TABLE IF EXISTS transport_shipments;
DROP TABLE IF EXISTS client_logistics_services;
DROP TABLE IF EXISTS logistics_services;
DROP TABLE IF EXISTS transport_chain_legs;
DROP TABLE IF EXISTS transport_chains;
DROP TABLE IF EXISTS transport_rate_brackets;
DROP TABLE IF EXISTS transport_rate_grids;
DROP TABLE IF EXISTS transport_fuel_surcharges;
DROP TABLE IF EXISTS supplier_transport_settings;

ALTER TABLE clients
  DROP CONSTRAINT IF EXISTS chk_clients_sale_transport_mode,
  DROP COLUMN IF EXISTS sale_transport_notes,
  DROP COLUMN IF EXISTS sale_transport_chain_id,
  DROP COLUMN IF EXISTS sale_transport_mode;

ALTER TABLE suppliers
  DROP COLUMN IF EXISTS is_carrier;
