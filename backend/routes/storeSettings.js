const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { requireAdminOrManager } = require('../middleware/authorization');
const { attachDbContext } = require('../middleware/dbContext');

const router = express.Router();

const STORE_SETTINGS_FIELDS = [
  'company_name',
  'logo_url',
  'address_line1',
  'address_line2',
  'postal_code',
  'city',
  'country',
  'phone',
  'email',
  'siret',
  'vat_number',
  'sanitary_approval_number',
  'iban',
  'bic',
  'payment_terms',
  'legal_mentions',
  'terms_and_conditions',
  'delivery_note_footer',
  'invoice_footer',
];

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function mapSettingsPayload(body = {}) {
  const settings = {};

  STORE_SETTINGS_FIELDS.forEach((field) => {
    settings[field] = normalizeText(body[field]);
  });

  settings.country = settings.country || 'France';

  return settings;
}

function settingsSelectSql() {
  return `
    SELECT
      id,
      store_id,
      company_name,
      logo_url,
      address_line1,
      address_line2,
      postal_code,
      city,
      country,
      phone,
      email,
      siret,
      vat_number,
      sanitary_approval_number,
      iban,
      bic,
      payment_terms,
      legal_mentions,
      terms_and_conditions,
      delivery_note_footer,
      invoice_footer,
      created_by,
      updated_by,
      created_at,
      updated_at
    FROM store_settings
  `;
}

async function findStoreSettings(req) {
  const result = await req.dbPool.query(
    `
    ${settingsSelectSql()}
    WHERE store_id = $1
    LIMIT 1
    `,
    [req.user.store_id]
  );

  return result.rows[0] || null;
}

router.get('/store-settings', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const settings = await findStoreSettings(req);
    res.json(settings);
  } catch (err) {
    console.error('Erreur GET /api/store-settings :', err);
    res.status(500).json({ error: 'Erreur serveur paramètres société' });
  }
});

router.post('/store-settings', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const settings = mapSettingsPayload(req.body);

    const result = await req.dbPool.query(
      `
      INSERT INTO store_settings (
        store_id,
        company_name,
        logo_url,
        address_line1,
        address_line2,
        postal_code,
        city,
        country,
        phone,
        email,
        siret,
        vat_number,
        sanitary_approval_number,
        iban,
        bic,
        payment_terms,
        legal_mentions,
        terms_and_conditions,
        delivery_note_footer,
        invoice_footer,
        created_by,
        updated_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22
      )
      RETURNING id
      `,
      [
        req.user.store_id,
        settings.company_name,
        settings.logo_url,
        settings.address_line1,
        settings.address_line2,
        settings.postal_code,
        settings.city,
        settings.country,
        settings.phone,
        settings.email,
        settings.siret,
        settings.vat_number,
        settings.sanitary_approval_number,
        settings.iban,
        settings.bic,
        settings.payment_terms,
        settings.legal_mentions,
        settings.terms_and_conditions,
        settings.delivery_note_footer,
        settings.invoice_footer,
        req.user.id,
        req.user.id,
      ]
    );

    const created = await findStoreSettings(req);
    res.status(201).json(created || { id: result.rows[0].id });
  } catch (err) {
    console.error('Erreur POST /api/store-settings :', err);
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Les paramètres société existent déjà pour ce magasin' });
    }
    res.status(500).json({ error: 'Erreur serveur création paramètres société' });
  }
});

router.put('/store-settings', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const settings = mapSettingsPayload(req.body);

    await req.dbPool.query(
      `
      INSERT INTO store_settings (
        store_id,
        company_name,
        logo_url,
        address_line1,
        address_line2,
        postal_code,
        city,
        country,
        phone,
        email,
        siret,
        vat_number,
        sanitary_approval_number,
        iban,
        bic,
        payment_terms,
        legal_mentions,
        terms_and_conditions,
        delivery_note_footer,
        invoice_footer,
        created_by,
        updated_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22
      )
      ON CONFLICT (store_id) DO UPDATE
      SET
        company_name = EXCLUDED.company_name,
        logo_url = EXCLUDED.logo_url,
        address_line1 = EXCLUDED.address_line1,
        address_line2 = EXCLUDED.address_line2,
        postal_code = EXCLUDED.postal_code,
        city = EXCLUDED.city,
        country = EXCLUDED.country,
        phone = EXCLUDED.phone,
        email = EXCLUDED.email,
        siret = EXCLUDED.siret,
        vat_number = EXCLUDED.vat_number,
        sanitary_approval_number = EXCLUDED.sanitary_approval_number,
        iban = EXCLUDED.iban,
        bic = EXCLUDED.bic,
        payment_terms = EXCLUDED.payment_terms,
        legal_mentions = EXCLUDED.legal_mentions,
        terms_and_conditions = EXCLUDED.terms_and_conditions,
        delivery_note_footer = EXCLUDED.delivery_note_footer,
        invoice_footer = EXCLUDED.invoice_footer,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
      `,
      [
        req.user.store_id,
        settings.company_name,
        settings.logo_url,
        settings.address_line1,
        settings.address_line2,
        settings.postal_code,
        settings.city,
        settings.country,
        settings.phone,
        settings.email,
        settings.siret,
        settings.vat_number,
        settings.sanitary_approval_number,
        settings.iban,
        settings.bic,
        settings.payment_terms,
        settings.legal_mentions,
        settings.terms_and_conditions,
        settings.delivery_note_footer,
        settings.invoice_footer,
        req.user.id,
        req.user.id,
      ]
    );

    const updated = await findStoreSettings(req);
    res.json(updated);
  } catch (err) {
    console.error('Erreur PUT /api/store-settings :', err);
    res.status(500).json({ error: 'Erreur serveur mise à jour paramètres société' });
  }
});

module.exports = router;
