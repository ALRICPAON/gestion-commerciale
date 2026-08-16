BEGIN;

DROP INDEX IF EXISTS idx_articles_store_article_category;

ALTER TABLE articles
  DROP CONSTRAINT IF EXISTS articles_article_category_check;

ALTER TABLE articles
  DROP COLUMN IF EXISTS article_category;

COMMIT;
