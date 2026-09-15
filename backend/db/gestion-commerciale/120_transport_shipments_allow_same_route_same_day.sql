-- Allow several real transport shipments on the same business route/day.
-- Only technical ids are unique; date/chain/direction/carrier/origin/destination
-- must not act as a business idempotency key.

DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'transport_shipments'
      AND con.contype = 'u'
      AND ARRAY(
        SELECT att.attname
        FROM unnest(con.conkey) WITH ORDINALITY AS key(attnum, ord)
        JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = key.attnum
        ORDER BY key.ord
      ) <@ ARRAY[
        'store_id',
        'shipment_date',
        'direction',
        'carrier_id',
        'chain_id',
        'origin_label',
        'destination_label'
      ]::name[]
  LOOP
    EXECUTE format('ALTER TABLE public.transport_shipments DROP CONSTRAINT IF EXISTS %I', item.conname);
  END LOOP;

  FOR item IN
    SELECT idx.indexrelid::regclass::text AS index_name
    FROM pg_index idx
    JOIN pg_class rel ON rel.oid = idx.indrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'transport_shipments'
      AND idx.indisunique = true
      AND idx.indisprimary = false
      AND ARRAY(
        SELECT att.attname
        FROM unnest(idx.indkey::int2[]) WITH ORDINALITY AS key(attnum, ord)
        JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = key.attnum
        ORDER BY key.ord
      ) <@ ARRAY[
        'store_id',
        'shipment_date',
        'direction',
        'carrier_id',
        'chain_id',
        'origin_label',
        'destination_label'
      ]::name[]
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %s', item.index_name);
  END LOOP;
END $$;

ALTER TABLE transport_shipments
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_transport_shipments_idempotency_key
  ON transport_shipments(store_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
