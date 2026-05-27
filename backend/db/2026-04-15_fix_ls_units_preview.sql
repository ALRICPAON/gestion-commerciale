BEGIN;

UPDATE articles a
SET unit = 'piece'
FROM article_departments ad
LEFT JOIN article_department_metadata adm
  ON adm.article_department_id = ad.id
 AND adm.field_key = 'v2_import'
WHERE ad.article_id = a.id
  AND UPPER(COALESCE(adm.category, '')) = 'POISSONNERIE_LS'
  AND COALESCE(a.unit, '') <> 'piece';

UPDATE article_departments ad
SET
  purchase_unit = 'piece',
  stock_unit = 'piece',
  sale_unit = 'piece'
FROM article_department_metadata adm
WHERE adm.article_department_id = ad.id
  AND adm.field_key = 'v2_import'
  AND UPPER(COALESCE(adm.category, '')) = 'POISSONNERIE_LS'
  AND (
    COALESCE(ad.purchase_unit, '') <> 'piece'
    OR COALESCE(ad.stock_unit, '') <> 'piece'
    OR COALESCE(ad.sale_unit, '') <> 'piece'
  );

COMMIT;