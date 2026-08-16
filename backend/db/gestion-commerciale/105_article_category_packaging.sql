BEGIN;

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS article_category text NOT NULL DEFAULT 'product';

UPDATE articles
SET article_category = 'product'
WHERE article_category IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'articles'::regclass
      AND conname = 'articles_article_category_check'
  ) THEN
    ALTER TABLE articles
      ADD CONSTRAINT articles_article_category_check
      CHECK (article_category IN ('product', 'packaging'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_articles_store_article_category
ON articles(store_id, article_category);

COMMIT;
