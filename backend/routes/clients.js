const express = require('express');

const router = express.Router();

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');

function requireRole(allowedRoles = []) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    next();
  };
}

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function normalizeStatus(value) {
  const status = normalizeText(value) || 'active';
  const allowed = ['active', 'inactive', 'blocked'];
  return allowed.includes(status) ? status : 'active';
}

function normalizeClientType(value) {
  const clientType = normalizeText(value) || 'standard';
  const allowed = ['standard', 'grossiste', 'gms', 'restaurant', 'poissonnerie', 'export', 'autre'];
  return allowed.includes(clientType) ? clientType : 'standard';
}

function normalizeTariffLevel(value) {
  const parsed = Number(value || 1);
  return [1, 2, 3].includes(parsed) ? parsed : 1;
}

function normalizeUuid(value) {
  const text = normalizeText(value);
  if (!text) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

function clientSelectSql() {
  return `
    SELECT
      c.id,
      c.code,
      c.name,
      c.legal_name,
      c.client_type,
      c.status,
      c.tariff_level,
      COALESCE(c.billed_client_id, c.id) AS billed_client_id,
      billed.code AS billed_client_code,
      billed.name AS billed_client_name,
      c.store_identifier,
      c.contact_name,
      c.phone,
      c.mobile,
      c.email,
      c.address_line1,
      c.address_line2,
      c.postal_code,
      c.city,
      c.country,
      c.vat_number,
      c.siret,
      c.payment_terms,
      c.delivery_terms,
      c.notes,
      c.created_at,
      c.updated_at
    FROM clients c
    LEFT JOIN clients billed
      ON billed.id = COALESCE(c.billed_client_id, c.id)
     AND billed.store_id = c.store_id
  `;
}

function mapClientPayload(body) {
  return {
    code: normalizeText(body.code),
    name: normalizeText(body.name),
    legal_name: normalizeText(body.legal_name),
    client_type: normalizeClientType(body.client_type),
    status: normalizeStatus(body.status),
    tariff_level: normalizeTariffLevel(body.tariff_level ?? body.price_level),
    billed_client_id: normalizeUuid(body.billed_client_id),
    store_identifier: normalizeText(body.store_identifier),

    contact_name: normalizeText(body.contact_name),
    phone: normalizeText(body.phone),
    mobile: normalizeText(body.mobile),
    email: normalizeText(body.email),

    address_line1: normalizeText(body.address_line1),
    address_line2: normalizeText(body.address_line2),
    postal_code: normalizeText(body.postal_code),
    city: normalizeText(body.city),
    country: normalizeText(body.country) || 'France',

    vat_number: normalizeText(body.vat_number),
    siret: normalizeText(body.siret),

    payment_terms: normalizeText(body.payment_terms),
    delivery_terms: normalizeText(body.delivery_terms),

    notes: normalizeText(body.notes),
  };
}

async function ensureBilledClient(req, billedClientId) {
  if (!billedClientId) return null;

  const result = await req.dbPool.query(
    `
    SELECT id
    FROM clients
    WHERE id = $1
      AND store_id = $2
      AND status <> 'inactive'
    LIMIT 1
    `,
    [billedClientId, req.user.store_id]
  );

  if (result.rows.length === 0) {
    const error = new Error('Client facturé introuvable pour ce magasin');
    error.status = 400;
    throw error;
  }

  return billedClientId;
}

router.get('/clients', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const { search, status, client_type } = req.query;

    const params = [req.user.store_id];
    const where = ['c.store_id = $1'];

    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      where.push(`
        (
          c.code ILIKE $${params.length}
          OR c.name ILIKE $${params.length}
          OR c.legal_name ILIKE $${params.length}
          OR c.store_identifier ILIKE $${params.length}
          OR c.contact_name ILIKE $${params.length}
          OR c.email ILIKE $${params.length}
          OR c.phone ILIKE $${params.length}
          OR c.city ILIKE $${params.length}
        )
      `);
    }

    if (status && String(status).trim() !== 'all') {
      params.push(String(status).trim());
      where.push(`c.status = $${params.length}`);
    }

    if (client_type && String(client_type).trim() !== 'all') {
      params.push(String(client_type).trim());
      where.push(`c.client_type = $${params.length}`);
    }

    const result = await req.dbPool.query(
      `
      ${clientSelectSql()}
      WHERE ${where.join(' AND ')}
      ORDER BY c.name ASC, c.code ASC
      `,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur GET /api/clients :', err);
    res.status(500).json({ error: 'Erreur serveur clients' });
  }
});

router.get('/clients/:id', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const result = await req.dbPool.query(
      `
      ${clientSelectSql()}
      WHERE c.id = $1
        AND c.store_id = $2
      `,
      [req.params.id, req.user.store_id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Client introuvable' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur GET /api/clients/:id :', err);
    res.status(500).json({ error: 'Erreur serveur client' });
  }
});

router.post(
  '/clients',
  authenticateToken,
  attachDbContext,
  requireRole(['admin', 'responsable', 'commercial']),
  async (req, res) => {
    try {
      const client = mapClientPayload(req.body);
      if (!client.name) return res.status(400).json({ error: 'Le nom client est obligatoire' });

      const billedClientId = await ensureBilledClient(req, client.billed_client_id);

      const result = await req.dbPool.query(
        `
        INSERT INTO clients (
          store_id, code, name, legal_name, client_type, status, tariff_level,
          billed_client_id, store_identifier,
          contact_name, phone, mobile, email,
          address_line1, address_line2, postal_code, city, country,
          vat_number, siret, payment_terms, delivery_terms, notes,
          created_by, updated_by
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9,
          $10, $11, $12, $13,
          $14, $15, $16, $17, $18,
          $19, $20, $21, $22, $23,
          $24, $25
        )
        RETURNING id
        `,
        [
          req.user.store_id,
          client.code,
          client.name,
          client.legal_name,
          client.client_type,
          client.status,
          client.tariff_level,
          billedClientId,
          client.store_identifier,
          client.contact_name,
          client.phone,
          client.mobile,
          client.email,
          client.address_line1,
          client.address_line2,
          client.postal_code,
          client.city,
          client.country,
          client.vat_number,
          client.siret,
          client.payment_terms,
          client.delivery_terms,
          client.notes,
          req.user.id,
          req.user.id,
        ]
      );

      const createdId = result.rows[0].id;
      await req.dbPool.query(
        `UPDATE clients SET billed_client_id = COALESCE(billed_client_id, id) WHERE id = $1`,
        [createdId]
      );

      const created = await req.dbPool.query(
        `${clientSelectSql()} WHERE c.id = $1 AND c.store_id = $2`,
        [createdId, req.user.store_id]
      );

      res.status(201).json(created.rows[0]);
    } catch (err) {
      console.error('Erreur POST /api/clients :', err);
      if (err.code === '23505') return res.status(400).json({ error: 'Code client déjà existant' });
      res.status(err.status || 500).json({ error: err.message || 'Erreur serveur création client' });
    }
  }
);

router.put(
  '/clients/:id',
  authenticateToken,
  attachDbContext,
  requireRole(['admin', 'responsable', 'commercial']),
  async (req, res) => {
    try {
      const client = mapClientPayload(req.body);
      if (!client.name) return res.status(400).json({ error: 'Le nom client est obligatoire' });

      const billedClientId = await ensureBilledClient(req, client.billed_client_id || req.params.id);

      const result = await req.dbPool.query(
        `
        UPDATE clients
        SET
          code = $1,
          name = $2,
          legal_name = $3,
          client_type = $4,
          status = $5,
          tariff_level = $6,
          billed_client_id = $7,
          store_identifier = $8,
          contact_name = $9,
          phone = $10,
          mobile = $11,
          email = $12,
          address_line1 = $13,
          address_line2 = $14,
          postal_code = $15,
          city = $16,
          country = $17,
          vat_number = $18,
          siret = $19,
          payment_terms = $20,
          delivery_terms = $21,
          notes = $22,
          updated_by = $23
        WHERE id = $24
          AND store_id = $25
        RETURNING id
        `,
        [
          client.code,
          client.name,
          client.legal_name,
          client.client_type,
          client.status,
          client.tariff_level,
          billedClientId,
          client.store_identifier,
          client.contact_name,
          client.phone,
          client.mobile,
          client.email,
          client.address_line1,
          client.address_line2,
          client.postal_code,
          client.city,
          client.country,
          client.vat_number,
          client.siret,
          client.payment_terms,
          client.delivery_terms,
          client.notes,
          req.user.id,
          req.params.id,
          req.user.store_id,
        ]
      );

      if (result.rows.length === 0) return res.status(404).json({ error: 'Client introuvable' });

      const updated = await req.dbPool.query(
        `${clientSelectSql()} WHERE c.id = $1 AND c.store_id = $2`,
        [req.params.id, req.user.store_id]
      );

      res.json(updated.rows[0]);
    } catch (err) {
      console.error('Erreur PUT /api/clients/:id :', err);
      if (err.code === '23505') return res.status(400).json({ error: 'Code client déjà existant' });
      res.status(err.status || 500).json({ error: err.message || 'Erreur serveur modification client' });
    }
  }
);

router.patch('/clients/:id/status', authenticateToken, attachDbContext, requireRole(['admin', 'responsable']), async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'inactive', 'blocked'].includes(status)) return res.status(400).json({ error: 'Statut client invalide' });

    const result = await req.dbPool.query(
      `UPDATE clients SET status = $1, updated_by = $2 WHERE id = $3 AND store_id = $4 RETURNING id, status`,
      [status, req.user.id, req.params.id, req.user.store_id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Client introuvable' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur PATCH /api/clients/:id/status :', err);
    res.status(500).json({ error: 'Erreur serveur statut client' });
  }
});

router.delete('/clients/:id', authenticateToken, attachDbContext, requireRole(['admin']), async (req, res) => {
  try {
    const result = await req.dbPool.query(
      `UPDATE clients SET status = 'inactive', updated_by = $1 WHERE id = $2 AND store_id = $3 RETURNING id, status`,
      [req.user.id, req.params.id, req.user.store_id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Client introuvable' });
    res.json({ ok: true, client: result.rows[0] });
  } catch (err) {
    console.error('Erreur DELETE /api/clients/:id :', err);
    res.status(500).json({ error: 'Erreur serveur suppression client' });
  }
});

module.exports = router;
