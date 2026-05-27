INSERT INTO user_departments (id, user_id, department_id, is_default)
SELECT
  gen_random_uuid(),
  '4cdf1014-5dae-427e-beef-2aefc21997c5',
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
  WHERE ud.user_id = '4cdf1014-5dae-427e-beef-2aefc21997c5'
    AND ud.department_id = d.id
);