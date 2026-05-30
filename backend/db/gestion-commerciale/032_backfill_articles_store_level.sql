BEGIN;

WITH ranked_article_departments AS (
  SELECT
    ad.*,
    ROW_NUMBER() OVER (
      PARTITION BY ad.article_id
      ORDER BY
        CASE WHEN ad.is_active = true THEN 0 ELSE 1 END,
        CASE
          WHEN ad.department_sector_id IS NOT NULL
            OR ad.vat_rate IS NOT NULL
            OR ad.purchase_price_ex_vat IS NOT NULL
            OR ad.sale_price_ex_vat IS NOT NULL
            OR ad.sale_price_inc_vat IS NOT NULL
          THEN 0 ELSE 1
        END,
        ad.updated_at DESC NULLS LAST,
        ad.created_at DESC NULLS LAST
    ) AS rn
  FROM article_departments ad
),
article_source AS (
  SELECT
    ad.article_id,
    ds.code AS family_code,
    ds.name AS family_name,
    ad.display_name,
    ad.purchase_unit,
    ad.stock_unit,
    ad.sale_unit,
    ad.vat_rate,
    ad.purchase_price_ex_vat,
    ad.sale_price_ex_vat,
    ad.sale_price_inc_vat,
    adm.category,
    adm.latin_name,
    adm.fao_zone,
    adm.sous_zone,
    adm.engin,
    adm.allergenes
  FROM ranked_article_departments ad
  LEFT JOIN department_sectors ds ON ds.id = ad.department_sector_id
  LEFT JOIN article_department_metadata adm
    ON adm.article_department_id = ad.id
   AND adm.field_key = 'business_metadata'
  WHERE ad.rn = 1
)
UPDATE articles a
SET
  family_code = COALESCE(a.family_code, article_source.family_code),
  family_name = COALESCE(a.family_name, article_source.family_name),
  display_name = COALESCE(a.display_name, article_source.display_name),
  purchase_unit = COALESCE(a.purchase_unit, article_source.purchase_unit, a.unit),
  stock_unit = COALESCE(a.stock_unit, article_source.stock_unit, a.unit),
  sale_unit = COALESCE(a.sale_unit, article_source.sale_unit, a.unit),
  vat_rate = COALESCE(article_source.vat_rate, a.vat_rate, 5.50),
  purchase_price_ex_vat = COALESCE(article_source.purchase_price_ex_vat, a.purchase_price_ex_vat),
  sale_price_ex_vat = COALESCE(article_source.sale_price_ex_vat, a.sale_price_ex_vat),
  sale_price_inc_vat = COALESCE(article_source.sale_price_inc_vat, a.sale_price_inc_vat),
  production_method = COALESCE(a.production_method, article_source.category),
  latin_name = COALESCE(a.latin_name, article_source.latin_name),
  fao_zone = COALESCE(a.fao_zone, article_source.fao_zone),
  sous_zone = COALESCE(a.sous_zone, article_source.sous_zone),
  fishing_gear = COALESCE(a.fishing_gear, article_source.engin),
  allergens = COALESCE(a.allergens, article_source.allergenes),
  updated_at = NOW()
FROM article_source
WHERE article_source.article_id = a.id;

UPDATE articles
SET
  purchase_unit = COALESCE(purchase_unit, unit, 'kg'),
  stock_unit = COALESCE(stock_unit, unit, 'kg'),
  sale_unit = COALESCE(sale_unit, unit, 'kg'),
  vat_rate = COALESCE(vat_rate, 5.50),
  updated_at = NOW()
WHERE purchase_unit IS NULL
   OR stock_unit IS NULL
   OR sale_unit IS NULL
   OR vat_rate IS NULL;

COMMIT;
