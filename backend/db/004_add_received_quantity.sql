ALTER TABLE purchase_lines
ADD COLUMN received_quantity NUMERIC(12,3);

ALTER TABLE purchase_lines
ADD COLUMN received_at TIMESTAMP;