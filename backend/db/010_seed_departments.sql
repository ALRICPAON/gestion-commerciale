-- =========================
-- INSERT DEPARTMENTS
-- =========================

-- Store : Leclerc Challans
-- ID déjà connu
-- c8ef6923-eb14-4fb2-a04f-4d05a65817e5

INSERT INTO departments (id, store_id, name, code, business_type)
VALUES
  (gen_random_uuid(), 'c8ef6923-eb14-4fb2-a04f-4d05a65817e5', 'Boucherie', 'BOUCH', 'boucherie'),
  (gen_random_uuid(), 'c8ef6923-eb14-4fb2-a04f-4d05a65817e5', 'Fruits et légumes', 'FDL', 'fruits_legumes'),
  (gen_random_uuid(), 'c8ef6923-eb14-4fb2-a04f-4d05a65817e5', 'Boulangerie', 'BOUL', 'boulangerie'),
  (gen_random_uuid(), 'c8ef6923-eb14-4fb2-a04f-4d05a65817e5', 'Charcuterie', 'CHAR', 'charcuterie'),
  (gen_random_uuid(), 'c8ef6923-eb14-4fb2-a04f-4d05a65817e5', 'Traiteur', 'TRAIT', 'traiteur'),
  (gen_random_uuid(), 'c8ef6923-eb14-4fb2-a04f-4d05a65817e5', 'Fromagerie', 'FROM', 'fromagerie');

-- =========================
-- LIAISON ADMIN → TOUS LES RAYONS
-- =========================

-- ID admin connu
-- fdca5268-e27c-4fee-9905-e48b02163434

INSERT INTO user_departments (id, user_id, department_id, is_default)
SELECT
  gen_random_uuid(),
  'fdca5268-e27c-4fee-9905-e48b02163434',
  d.id,
  CASE
    WHEN d.code = 'POIS' THEN true
    ELSE false
  END
FROM departments d
WHERE d.store_id = 'c8ef6923-eb14-4fb2-a04f-4d05a65817e5'
AND NOT EXISTS (
  SELECT 1
  FROM user_departments ud
  WHERE ud.user_id = 'fdca5268-e27c-4fee-9905-e48b02163434'
  AND ud.department_id = d.id
);