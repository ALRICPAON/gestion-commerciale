BEGIN;

CREATE OR REPLACE FUNCTION gc_next_sales_document_reference(
  p_store_id uuid,
  p_document_type text,
  p_prefix text,
  p_document_date date
) RETURNS text AS $$
DECLARE
  v_year integer;
  v_prefix text;
  v_suffix_pattern text;
  v_next integer;
BEGIN
  v_year := EXTRACT(YEAR FROM COALESCE(p_document_date, CURRENT_DATE))::integer;
  v_prefix := UPPER(p_prefix) || '-' || v_year || '-';
  v_suffix_pattern := '^' || UPPER(p_prefix) || '-' || v_year || '-([0-9]+)$';

  PERFORM pg_advisory_xact_lock(hashtext('sales-reference:' || p_store_id::text || ':' || UPPER(p_document_type) || ':' || v_year)::bigint);

  SELECT COALESCE(MAX((substring(reference_number FROM v_suffix_pattern))::integer), 0) + 1
    INTO v_next
  FROM sales_documents
  WHERE store_id = p_store_id
    AND UPPER(document_type) = UPPER(p_document_type)
    AND reference_number LIKE v_prefix || '%'
    AND substring(reference_number FROM v_suffix_pattern) IS NOT NULL;

  RETURN v_prefix || LPAD(v_next::text, 5, '0');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION gc_sales_documents_short_reference_before_insert()
RETURNS trigger AS $$
BEGIN
  IF UPPER(NEW.document_type) = 'ORDER'
     AND (
       NEW.reference_number IS NULL
       OR btrim(NEW.reference_number) = ''
       OR NEW.reference_number ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR NEW.reference_number ~* '^CMD-[0-9]{4}-[0-9]{2}-[0-9]{2}-'
     ) THEN
    NEW.reference_number := gc_next_sales_document_reference(NEW.store_id, 'ORDER', 'CMD', COALESCE(NEW.document_date, CURRENT_DATE));
  END IF;

  IF UPPER(NEW.document_type) = 'DELIVERY_NOTE'
     AND (
       NEW.reference_number IS NULL
       OR btrim(NEW.reference_number) = ''
       OR NEW.reference_number ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR NEW.reference_number ~* '^BL-[0-9]{4}-[0-9]{2}-[0-9]{2}-'
     ) THEN
    NEW.reference_number := gc_next_sales_document_reference(NEW.store_id, 'DELIVERY_NOTE', 'BL', COALESCE(NEW.document_date, CURRENT_DATE));
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sales_documents_short_references ON sales_documents;
CREATE TRIGGER trg_sales_documents_short_references
BEFORE INSERT ON sales_documents
FOR EACH ROW
EXECUTE FUNCTION gc_sales_documents_short_reference_before_insert();

COMMIT;
