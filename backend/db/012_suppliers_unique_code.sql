ALTER TABLE suppliers
ADD CONSTRAINT suppliers_store_code_unique UNIQUE (store_id, code);