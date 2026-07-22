BEGIN;

-- Rollback strict du module Conditionnement / Packaging introduit par la PR #208.
-- Executer d'abord diagnose_20260722_packaging_rollback.sql et relire ses sorties.
-- Ce script ne cible jamais l'article SOLE 120/170.

DO $$
DECLARE
  test_article_id constant uuid := '1038f6b7-4123-497d-8bc4-535833ea85e9';
  conflicting_articles bigint;
  ref record;
  ref_count bigint;
  blockers text := '';
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
  SELECT count(*)
  INTO conflicting_articles
  FROM public.articles
  WHERE (id = test_article_id OR plu = '4A15')
    AND NOT (
      id = test_article_id
      AND plu = '4A15'
      AND designation = 'CAISSE 4KG'
      AND COALESCE(source_origin, 'manual') = 'manual'
    );

  IF conflicting_articles > 0 THEN
    RAISE EXCEPTION 'Garde CAISSE 4KG bloquee: article id/plu inattendu detecte.';
  END IF;

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

    IF ref_count > 0 AND NOT (ref.nspname || '.' || ref.relname = ANY(accepted_tables)) THEN
      blockers := blockers || format('%s.%s.%s=%s; ', ref.nspname, ref.relname, ref.attname, ref_count);
    END IF;
  END LOOP;

  IF blockers <> '' THEN
    RAISE EXCEPTION 'Rollback bloque: references metier inattendues vers CAISSE 4KG: %', blockers;
  END IF;
END $$;

-- Index hors tables supprimees ou explicitement ajoutes par les migrations packaging.
DROP INDEX IF EXISTS public.idx_packaging_stock_movements_cancelled;
DROP INDEX IF EXISTS public.idx_packaging_stock_movements_source;
DROP INDEX IF EXISTS public.idx_packaging_cost_impacts_article;
DROP INDEX IF EXISTS public.idx_packaging_profile_components_packaging_article;
DROP INDEX IF EXISTS public.idx_packaging_operation_lines_packaging_article;
DROP INDEX IF EXISTS public.idx_returnable_packaging_movements_packaging_article;
DROP INDEX IF EXISTS public.idx_packaging_items_store_active;
DROP INDEX IF EXISTS public.idx_packaging_stock_movements_store_item_date;
DROP INDEX IF EXISTS public.idx_article_packaging_profiles_article;
DROP INDEX IF EXISTS public.ux_article_packaging_profiles_default;
DROP INDEX IF EXISTS public.idx_article_packaging_profile_components_profile;
DROP INDEX IF EXISTS public.idx_packaging_operations_store_date;
DROP INDEX IF EXISTS public.idx_packaging_operation_lines_operation;
DROP INDEX IF EXISTS public.idx_returnable_packaging_movements_balance;
DROP INDEX IF EXISTS public.ux_stock_cost_components_source;
DROP INDEX IF EXISTS public.idx_stock_cost_components_article;
DROP INDEX IF EXISTS public.idx_stock_cost_components_lot;
DROP INDEX IF EXISTS public.idx_articles_store_article_type;

ALTER TABLE IF EXISTS public.purchase_lines
  DROP CONSTRAINT IF EXISTS purchase_lines_line_business_type_check;

ALTER TABLE IF EXISTS public.purchase_lines
  DROP COLUMN IF EXISTS packaging_item_id,
  DROP COLUMN IF EXISTS line_business_type,
  DROP COLUMN IF EXISTS is_deposit_line;

DROP TABLE IF EXISTS public.stock_cost_components;
DROP TABLE IF EXISTS public.packaging_cost_impacts;
DROP TABLE IF EXISTS public.packaging_operation_lines;
DROP TABLE IF EXISTS public.returnable_packaging_movements;
DROP TABLE IF EXISTS public.article_packaging_profile_components;
DROP TABLE IF EXISTS public.packaging_operations;
DROP TABLE IF EXISTS public.packaging_stock_movements;
DROP TABLE IF EXISTS public.article_packaging_profiles;
DROP TABLE IF EXISTS public.packaging_items;

DO $$
DECLARE
  test_article_id constant uuid := '1038f6b7-4123-497d-8bc4-535833ea85e9';
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.articles
    WHERE id = test_article_id
      AND plu = '4A15'
      AND designation = 'CAISSE 4KG'
      AND COALESCE(source_origin, 'manual') = 'manual'
  ) THEN
    IF to_regclass('public.article_department_metadata') IS NOT NULL
      AND to_regclass('public.article_departments') IS NOT NULL THEN
      EXECUTE
        'DELETE FROM public.article_department_metadata adm
          USING public.article_departments ad
          WHERE adm.article_department_id = ad.id
            AND ad.article_id = $1'
      USING test_article_id;
    END IF;

    IF to_regclass('public.stock_movements') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.stock_movements WHERE article_id = $1' USING test_article_id;
    END IF;

    IF to_regclass('public.stock_summary') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.stock_summary WHERE article_id = $1' USING test_article_id;
    END IF;

    IF to_regclass('public.supplier_article_mappings') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.supplier_article_mappings WHERE article_id = $1' USING test_article_id;
    END IF;

    IF to_regclass('public.article_departments') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.article_departments WHERE article_id = $1' USING test_article_id;
    END IF;

    DELETE FROM public.articles
    WHERE id = test_article_id
      AND plu = '4A15'
      AND designation = 'CAISSE 4KG'
      AND COALESCE(source_origin, 'manual') = 'manual';
  ELSE
    RAISE NOTICE 'Article de test CAISSE 4KG absent: aucune suppression article effectuee.';
  END IF;
END $$;

ALTER TABLE IF EXISTS public.articles
  DROP CONSTRAINT IF EXISTS articles_article_type_check;

ALTER TABLE IF EXISTS public.articles
  DROP COLUMN IF EXISTS primary_supplier_id,
  DROP COLUMN IF EXISTS format_label,
  DROP COLUMN IF EXISTS alert_threshold,
  DROP COLUMN IF EXISTS deposit_unit_value,
  DROP COLUMN IF EXISTS contributes_to_product_cost,
  DROP COLUMN IF EXISTS visible_in_price_list,
  DROP COLUMN IF EXISTS sellable,
  DROP COLUMN IF EXISTS stock_managed,
  DROP COLUMN IF EXISTS article_type;

SELECT
  'packaging_table_remaining' AS section,
  v.table_name AS object_name,
  CASE WHEN to_regclass('public.' || v.table_name) IS NULL THEN 'missing_ok' ELSE 'still_present' END AS status
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
  'caisse_4kg_remaining' AS section,
  count(*) AS row_count
FROM public.articles
WHERE id = '1038f6b7-4123-497d-8bc4-535833ea85e9'
   OR plu = '4A15';

SELECT
  'main_table_presence' AS section,
  v.table_name AS object_name,
  CASE WHEN to_regclass('public.' || v.table_name) IS NULL THEN 'missing' ELSE 'present_ok' END AS status
FROM (
  VALUES
    ('articles'),
    ('purchase_lines'),
    ('purchases'),
    ('stock_summary'),
    ('stock_movements'),
    ('lots'),
    ('suppliers'),
    ('clients')
) AS v(table_name)
ORDER BY v.table_name;

COMMIT;
