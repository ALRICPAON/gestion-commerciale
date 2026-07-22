BEGIN;

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS article_type text NOT NULL DEFAULT 'PRODUCT',
  ADD COLUMN IF NOT EXISTS stock_managed boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sellable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS visible_in_price_list boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS contributes_to_product_cost boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deposit_unit_value numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS alert_threshold numeric(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS format_label text,
  ADD COLUMN IF NOT EXISTS primary_supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'articles_article_type_check'
  ) THEN
    ALTER TABLE articles
      ADD CONSTRAINT articles_article_type_check
      CHECK (article_type IN ('PRODUCT', 'PACKAGING_CONSUMABLE', 'PACKAGING_RETURNABLE', 'OTHER'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_articles_store_article_type
  ON articles(store_id, article_type, is_active);

ALTER TABLE article_packaging_profile_components
  ADD COLUMN IF NOT EXISTS packaging_article_id uuid REFERENCES articles(id) ON DELETE RESTRICT;

ALTER TABLE packaging_operation_lines
  ADD COLUMN IF NOT EXISTS packaging_article_id uuid REFERENCES articles(id) ON DELETE RESTRICT;

ALTER TABLE returnable_packaging_movements
  ADD COLUMN IF NOT EXISTS packaging_article_id uuid REFERENCES articles(id) ON DELETE RESTRICT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'article_packaging_profile_components'
      AND column_name = 'packaging_item_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE article_packaging_profile_components
      ALTER COLUMN packaging_item_id DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'packaging_operation_lines'
      AND column_name = 'packaging_item_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE packaging_operation_lines
      ALTER COLUMN packaging_item_id DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'returnable_packaging_movements'
      AND column_name = 'packaging_item_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE returnable_packaging_movements
      ALTER COLUMN packaging_item_id DROP NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'packaging_operation_lines'
      AND column_name = 'stock_movement_id'
  ) THEN
    ALTER TABLE packaging_operation_lines
      ALTER COLUMN stock_movement_id DROP NOT NULL;
  END IF;
END $$;

ALTER TABLE packaging_cost_impacts
  ADD COLUMN IF NOT EXISTS lot_id uuid REFERENCES lots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cost_component text NOT NULL DEFAULT 'PACKAGING';

CREATE INDEX IF NOT EXISTS idx_packaging_profile_components_packaging_article
  ON article_packaging_profile_components(store_id, packaging_article_id);

CREATE INDEX IF NOT EXISTS idx_packaging_operation_lines_packaging_article
  ON packaging_operation_lines(store_id, packaging_article_id);

CREATE INDEX IF NOT EXISTS idx_returnable_packaging_movements_packaging_article
  ON returnable_packaging_movements(store_id, packaging_article_id, supplier_id, movement_date DESC);

COMMIT;
