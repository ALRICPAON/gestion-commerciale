BEGIN READ ONLY;

-- Diagnostic lecture seule avant rollback du module Conditionnement / Packaging.
-- Ce fichier ne modifie aucune donnee et ne doit servir qu'a valider le perimetre.

SELECT
  'packaging_table' AS section,
  v.table_name AS object_name,
  CASE WHEN to_regclass('public.' || v.table_name) IS NULL THEN 'missing' ELSE 'present' END AS status
FROM (
  VALUES
    ('packaging_items'),
    ('packaging_stock_movements'),
    ('article_packaging_profiles'),
    ('article_packaging_profile_components'),
    ('packaging_operations'),
    ('packaging_operation_lines'),
    ('returnable_packaging_movements'),
    ('packaging_cost_impacts'),
    ('stock_cost_components')
) AS v(table_name)
ORDER BY v.table_name;

SELECT
  'article_column' AS section,
  column_name AS object_name,
  data_type AS detail
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'articles'
  AND column_name IN (
    'article_type',
    'stock_managed',
    'sellable',
    'visible_in_price_list',
    'contributes_to_product_cost',
    'deposit_unit_value',
    'alert_threshold',
    'format_label',
    'primary_supplier_id'
  )
ORDER BY column_name;

SELECT
  'purchase_line_column' AS section,
  column_name AS object_name,
  data_type AS detail
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'purchase_lines'
  AND column_name IN (
    'line_business_type',
    'packaging_item_id',
    'is_deposit_line'
  )
ORDER BY column_name;

SELECT
  'constraint' AS section,
  conname AS object_name,
  conrelid::regclass::text AS detail
FROM pg_constraint
WHERE conname IN (
  'articles_article_type_check',
  'purchase_lines_line_business_type_check'
)
ORDER BY conname;

SELECT
  'index' AS section,
  indexname AS object_name,
  tablename AS detail
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'idx_packaging_items_store_active',
    'idx_packaging_stock_movements_store_item_date',
    'idx_article_packaging_profiles_article',
    'ux_article_packaging_profiles_default',
    'idx_article_packaging_profile_components_profile',
    'idx_packaging_operations_store_date',
    'idx_packaging_operation_lines_operation',
    'idx_returnable_packaging_movements_balance',
    'idx_packaging_stock_movements_cancelled',
    'idx_packaging_stock_movements_source',
    'idx_packaging_cost_impacts_article',
    'idx_packaging_profile_components_packaging_article',
    'idx_packaging_operation_lines_packaging_article',
    'idx_returnable_packaging_movements_packaging_article',
    'idx_articles_store_article_type',
    'ux_stock_cost_components_source',
    'idx_stock_cost_components_article',
    'idx_stock_cost_components_lot'
  )
ORDER BY indexname;

DO $$
DECLARE
  table_name text;
  row_count bigint;
  table_names text[] := ARRAY[
    'packaging_items',
    'packaging_stock_movements',
    'article_packaging_profiles',
    'article_packaging_profile_components',
    'packaging_operations',
    'packaging_operation_lines',
    'returnable_packaging_movements',
    'packaging_cost_impacts',
    'stock_cost_components'
  ];
BEGIN
  FOREACH table_name IN ARRAY table_names LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', table_name) INTO row_count;
      RAISE NOTICE 'table_count %. rows=%', table_name, row_count;
    ELSE
      RAISE NOTICE 'table_count %. missing', table_name;
    END IF;
  END LOOP;
END $$;

SELECT
  'caisse_4kg_article' AS section,
  id,
  store_id,
  plu,
  designation,
  source_origin,
  is_active
FROM articles
WHERE id = '1038f6b7-4123-497d-8bc4-535833ea85e9'
   OR plu = '4A15'
ORDER BY id;

DO $$
DECLARE
  test_article_id constant uuid := '1038f6b7-4123-497d-8bc4-535833ea85e9';
  ref record;
  ref_count bigint;
  accepted_tables constant text[] := ARRAY[
    'public.packaging_operations',
    'public.packaging_operation_lines',
    'public.article_packaging_profiles',
    'public.article_packaging_profile_components',
    'public.returnable_packaging_movements',
    'public.packaging_cost_impacts',
    'public.stock_cost_components',
    'public.stock_summary',
    'public.stock_movements',
    'public.supplier_article_mappings',
    'public.article_departments'
  ];
BEGIN
  FOR ref IN
    SELECT
      n.nspname,
      c.relname,
      a.attname
    FROM pg_constraint fk
    JOIN pg_class c ON c.oid = fk.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN unnest(fk.conkey) WITH ORDINALITY ck(attnum, ord) ON true
    JOIN unnest(fk.confkey) WITH ORDINALITY rk(attnum, ord) ON rk.ord = ck.ord
    JOIN pg_attribute a ON a.attrelid = fk.conrelid AND a.attnum = ck.attnum
    JOIN pg_attribute ra ON ra.attrelid = fk.confrelid AND ra.attnum = rk.attnum
    WHERE fk.contype = 'f'
      AND fk.confrelid = 'public.articles'::regclass
      AND ra.attname = 'id'
      AND array_length(fk.conkey, 1) = 1
      AND array_length(fk.confkey, 1) = 1
      AND n.nspname = 'public'
    ORDER BY n.nspname, c.relname, a.attname
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I = $1', ref.nspname, ref.relname, ref.attname)
      INTO ref_count
      USING test_article_id;

    RAISE NOTICE 'caisse_4kg_reference %.%.% rows=%',
      ref.nspname,
      ref.relname,
      ref.attname,
      ref_count;

    IF ref_count > 0 AND NOT (ref.nspname || '.' || ref.relname = ANY(accepted_tables)) THEN
      RAISE NOTICE 'caisse_4kg_blocker %.%.% rows=%',
        ref.nspname,
        ref.relname,
        ref.attname,
        ref_count;
    END IF;
  END LOOP;
END $$;

SELECT
  'sole_120_170_control' AS section,
  a.id,
  a.store_id,
  a.plu,
  a.designation,
  a.source_origin,
  a.is_active,
  ss.stock_quantity,
  ss.stock_value_ex_vat,
  ss.pma
FROM articles a
LEFT JOIN stock_summary ss
  ON ss.article_id = a.id
 AND ss.store_id = a.store_id
WHERE a.id = '62519912-a5af-4a8c-9eba-e284a4cd62ef'
   OR a.designation = 'SOLE 120/170'
ORDER BY a.id;

COMMIT;
