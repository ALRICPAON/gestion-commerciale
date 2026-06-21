ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS is_royale_maree_member boolean NOT NULL DEFAULT false;
