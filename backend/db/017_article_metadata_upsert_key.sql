BEGIN;

ALTER TABLE article_department_metadata
    ALTER COLUMN field_key SET NOT NULL;

ALTER TABLE article_department_metadata
    ADD CONSTRAINT uq_article_department_metadata_article_field
    UNIQUE (article_department_id, field_key);

COMMIT;