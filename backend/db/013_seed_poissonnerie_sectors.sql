INSERT INTO department_sectors (
  department_id,
  code,
  name,
  description,
  color_hex,
  display_order,
  is_active
)
SELECT
  d.id,
  s.code,
  s.name,
  s.description,
  s.color_hex,
  s.display_order,
  true
FROM departments d
CROSS JOIN (
  VALUES
    ('TRAD', 'Traditionnel', 'Vente traditionnelle poissonnerie', '#005BAA', 1),
    ('LS',   'Libre-service', 'Produits libre-service', '#1D4ED8', 2),
    ('EMB',  'Emballages', 'Consommables et emballages du rayon', '#6B7280', 3),
    ('SCE',  'Sauces et accompagnements', 'Sauces, légumes, aides culinaires, traiteur', '#2F855A', 4),
    ('FE',   'Fabrication élaborée', 'Préparations et fabrications internes', '#7C3AED', 5)
) AS s(code, name, description, color_hex, display_order)
WHERE d.code = 'POIS'
AND NOT EXISTS (
  SELECT 1
  FROM department_sectors ds
  WHERE ds.department_id = d.id
    AND ds.code = s.code
);