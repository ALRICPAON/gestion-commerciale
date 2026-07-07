ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS royale_maree_commission_eur_per_kg numeric(10,2);

UPDATE store_settings
SET royale_maree_commission_eur_per_kg = 0.50
WHERE royale_maree_commission_eur_per_kg IS NULL;

ALTER TABLE store_settings
  ALTER COLUMN royale_maree_commission_eur_per_kg SET DEFAULT 0.50;

ALTER TABLE store_settings
  ALTER COLUMN royale_maree_commission_eur_per_kg SET NOT NULL;

COMMENT ON COLUMN store_settings.royale_maree_commission_eur_per_kg
  IS 'Commission ROYALE MAREE en euros par kg ajoutee uniquement aux mercuriales Leclerc.';
