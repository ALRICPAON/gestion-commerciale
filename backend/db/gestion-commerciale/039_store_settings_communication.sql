BEGIN;

ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS email_sender_name text DEFAULT 'ALTA MARÉE',
  ADD COLUMN IF NOT EXISTS email_sender_address text DEFAULT 'commercial@altamaree.fr',
  ADD COLUMN IF NOT EXISTS contact_email text DEFAULT 'contact@altamaree.fr',
  ADD COLUMN IF NOT EXISTS internal_email text DEFAULT 'alric@altamaree.fr',
  ADD COLUMN IF NOT EXISTS webmail_url text DEFAULT 'https://mail.altamaree.fr',
  ADD COLUMN IF NOT EXISTS calendar_url text DEFAULT 'https://mail.altamaree.fr';

UPDATE store_settings
SET
  email_sender_name = COALESCE(NULLIF(btrim(email_sender_name), ''), 'ALTA MARÉE'),
  email_sender_address = COALESCE(NULLIF(btrim(email_sender_address), ''), 'commercial@altamaree.fr'),
  contact_email = COALESCE(NULLIF(btrim(contact_email), ''), 'contact@altamaree.fr'),
  internal_email = COALESCE(NULLIF(btrim(internal_email), ''), 'alric@altamaree.fr'),
  webmail_url = COALESCE(NULLIF(btrim(webmail_url), ''), 'https://mail.altamaree.fr'),
  calendar_url = COALESCE(NULLIF(btrim(calendar_url), ''), 'https://mail.altamaree.fr');

COMMIT;
