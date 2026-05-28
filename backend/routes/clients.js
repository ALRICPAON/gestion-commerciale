const express = require('express');

const router = express.Router();

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');

const { requireAdminOrManager } = require('../middleware/authorization');

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

  const allowed = [
    'standard',
    'grossiste',
    'gms',
    'restaurant',
    'poissonnerie',
    'export',
    'autre',
  ];

  return allowed.includes(clientType) ? clientType : 'standard';
}

function mapClientPayload(body) {
  return {
    code: normalizeText(body.code),
    name: normalizeText(body.name),
    legal_name: normalizeText(body.legal_name),
    client_type: normalizeClientType(body.client_type),
    status: normalizeStatus(body.status),

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

router.get('/clients', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const { search, status, client_type } = req.query;

    const params = [req.user.store_id];
    const where = ['store_id = $1'];

    if (search && String(search).trim()) {
      params.push(`%${String(search).trim()}%`);
      where.push(`
        (
          code ILIKE $${params.length}
          OR name ILIKE $${params.length}
          OR legal_name ILIKE $${params.length}
          OR contact_name ILIKE $${params.length}
          OR email ILIKE $${params.length}
          OR phone ILIKE $${params.length}
          OR city ILIKE $${params.length}
        )
      `);
    }

    if (status && String(status).trim() !== 'all') {
      params.push(String(status).trim());
      where.push(`status = $${params.length}`);
    }

    if (client_type && String(client_type).trim() !== 'all') {
      params.push(String(client_type).trim());
      where.push(`client_type = $${params.length}`);
    }

    const result = await req.dbPool.query(
      `
      SELECT
        id,
        code,
        name,
        legal_name,
        client_type,
        status,
        contact_name,
        phone,
        mobile,
        email,
        address_line1,
        address_line2,
        postal_code,
        city,
        country,
        vat_number,
        siret,
        payment_terms,
        delivery_terms,
        notes,
        created_at,
        updated_at
      FROM clients
      WHERE ${where.join(' AND ')}
      ORDER BY name ASC, code ASC
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
      SELECT
        id,
        code,
        name,
        legal_name,
        client_type,
        status,
        contact_name,
        phone,
        mobile,
        email,
        address_line1,
        address_line2,
        postal_code,
        city,
        country,
        vat_number,
        siret,
        payment_terms,
        delivery_terms,
        notes,
        created_at,
        updated_at
      FROM clients
      WHERE id = $1
        AND store_id = $2
      `,
      [req.params.id, req.user.store_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client introuvable' });
    }

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

      if (!client.name) {
        return res.status(400).json({ error: 'Le nom client est obligatoire' });
      }

      const result = await req.dbPool.query(
        `
        INSERT INTO clients (
          store_id,
          code,
          name,
          legal_name,
          client_type,
          status,
          contact_name,
          phone,
          mobile,
          email,
          address_line1,
          address_line2,
          postal_code,
          city,
          country,
          vat_number,
          siret,
          payment_terms,
          delivery_terms,
          notes,
          created_by,
          updated_by
        )
        VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10,
          $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20,
          $21, $22
        )
        RETURNING *
        `,
        [
          req.user.store_id,
          client.code,
          client.name,
          client.legal_name,
          client.client_type,
          client.status,
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

      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error('Erreur POST /api/clients :', err);

      if (err.code === '23505') {
        return res.status(400).json({ error: 'Code client déjà existant' });
      }

      res.status(500).json({ error: 'Erreur serveur création client' });
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

      if (!client.name) {
        return res.status(400).json({ error: 'Le nom client est obligatoire' });
      }

      const result = await req.dbPool.query(
        `
        UPDATE clients
        SET
          code = $1,
          name = $2,
          legal_name = $3,
          client_type = $4,
          status = $5,
          contact_name = $6,
          phone = $7,
          mobile = $8,
          email = $9,
          address_line1 = $10,
          address_line2 = $11,
          postal_code = $12,
          city = $13,
          country = $14,
          vat_number = $15,
          siret = $16,
          payment_terms = $17,
          delivery_terms = $18,
          notes = $19,
          updated_by = $20
        WHERE id = $21
          AND store_id = $22
        RETURNING *
        `,
        [
          client.code,
          client.name,
          client.legal_name,
          client.client_type,
          client.status,
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

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Client introuvable' });
      }

      res.json(result.rows[0]);
    } catch (err) {
      console.error('Erreur PUT /api/clients/:id :', err);

      if (err.code === '23505') {
        return res.status(400).json({ error: 'Code client déjà existant' });
      }

      res.status(500).json({ error: 'Erreur serveur modification client' });
    }
  }
);

router.patch(
  '/clients/:id/status',
  authenticateToken,
  attachDbContext,
  requireRole(['admin', 'responsable']),
  async (req, res) => {
    try {
      const { status } = req.body;

      if (!['active', 'inactive', 'blocked'].includes(status)) {
        return res.status(400).json({ error: 'Statut client invalide' });
      }

      const result = await req.dbPool.query(
        `
        UPDATE clients
        SET
          status = $1,
          updated_by = $2
        WHERE id = $3
          AND store_id = $4
        RETURNING id, status
        `,
        [status, req.user.id, req.params.id, req.user.store_id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Client introuvable' });
      }

      res.json(result.rows[0]);
    } catch (err) {
      console.error('Erreur PATCH /api/clients/:id/status :', err);
      res.status(500).json({ error: 'Erreur serveur statut client' });
    }
  }
);

router.delete(
  '/clients/:id',
  authenticateToken,
  attachDbContext,
  requireRole(['admin']),
  async (req, res) => {
    try {
      const result = await req.dbPool.query(
        `
        UPDATE clients
        SET
          status = 'inactive',
          updated_by = $1
        WHERE id = $2
          AND store_id = $3
        RETURNING id, status
        `,
        [req.user.id, req.params.id, req.user.store_id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Client introuvable' });
      }

      res.json({ ok: true, client: result.rows[0] });
    } catch (err) {
      console.error('Erreur DELETE /api/clients/:id :', err);
      res.status(500).json({ error: 'Erreur serveur suppression client' });
    }
  }
);

module.exports = router;