const express = require('express');

const router = express.Router();

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const {
  requireAdminOrManager,
  requireRole,
} = require('../middleware/authorization');

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

function normalizeSupplierType(value) {
  const supplierType = normalizeText(value) || 'standard';
  const allowed = [
    'standard',
    'mareyeur',
    'criee',
    'importateur',
    'transporteur',
    'emballage',
    'autre',
  ];
  return allowed.includes(supplierType) ? supplierType : 'standard';
}

function mapSupplierPayload(body) {
  return {
    code: normalizeText(body.code),
    name: normalizeText(body.name),
    legal_name: normalizeText(body.legal_name),
    supplier_type: normalizeSupplierType(body.supplier_type),
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

router.get('/suppliers', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const { search, status, supplier_type } = req.query;

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

    if (supplier_type && String(supplier_type).trim() !== 'all') {
      params.push(String(supplier_type).trim());
      where.push(`supplier_type = $${params.length}`);
    }

    const result = await req.dbPool.query(
      `
      SELECT
        id,
        code,
        name,
        legal_name,
        supplier_type,
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
      FROM suppliers
      WHERE ${where.join(' AND ')}
      ORDER BY name ASC, code ASC
      `,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur GET /api/suppliers :', err);
    res.status(500).json({ error: 'Erreur serveur fournisseurs' });
  }
});

router.get('/suppliers/:id', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const result = await req.dbPool.query(
      `
      SELECT
        id,
        code,
        name,
        legal_name,
        supplier_type,
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
      FROM suppliers
      WHERE id = $1
        AND store_id = $2
      `,
      [req.params.id, req.user.store_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Fournisseur introuvable' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur GET /api/suppliers/:id :', err);
    res.status(500).json({ error: 'Erreur serveur fournisseur' });
  }
});

router.post(
  '/suppliers',
  authenticateToken,
  attachDbContext,
  requireRole(['admin', 'responsable', 'commercial']),
  async (req, res) => {
    try {
      const supplier = mapSupplierPayload(req.body);

      if (!supplier.name) {
        return res.status(400).json({ error: 'Le nom fournisseur est obligatoire' });
      }

      const result = await req.dbPool.query(
        `
        INSERT INTO suppliers (
          store_id,
          code,
          name,
          legal_name,
          supplier_type,
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
          supplier.code,
          supplier.name,
          supplier.legal_name,
          supplier.supplier_type,
          supplier.status,
          supplier.contact_name,
          supplier.phone,
          supplier.mobile,
          supplier.email,
          supplier.address_line1,
          supplier.address_line2,
          supplier.postal_code,
          supplier.city,
          supplier.country,
          supplier.vat_number,
          supplier.siret,
          supplier.payment_terms,
          supplier.delivery_terms,
          supplier.notes,
          req.user.id,
          req.user.id,
        ]
      );

      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error('Erreur POST /api/suppliers :', err);

      if (err.code === '23505') {
        return res.status(400).json({ error: 'Code fournisseur déjà existant' });
      }

      res.status(500).json({ error: 'Erreur serveur création fournisseur' });
    }
  }
);

router.put(
  '/suppliers/:id',
  authenticateToken,
  attachDbContext,
  requireRole(['admin', 'responsable', 'commercial']),
  async (req, res) => {
    try {
      const supplier = mapSupplierPayload(req.body);

      if (!supplier.name) {
        return res.status(400).json({ error: 'Le nom fournisseur est obligatoire' });
      }

      const result = await req.dbPool.query(
        `
        UPDATE suppliers
        SET
          code = $1,
          name = $2,
          legal_name = $3,
          supplier_type = $4,
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
          supplier.code,
          supplier.name,
          supplier.legal_name,
          supplier.supplier_type,
          supplier.status,
          supplier.contact_name,
          supplier.phone,
          supplier.mobile,
          supplier.email,
          supplier.address_line1,
          supplier.address_line2,
          supplier.postal_code,
          supplier.city,
          supplier.country,
          supplier.vat_number,
          supplier.siret,
          supplier.payment_terms,
          supplier.delivery_terms,
          supplier.notes,
          req.user.id,
          req.params.id,
          req.user.store_id,
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Fournisseur introuvable' });
      }

      res.json(result.rows[0]);
    } catch (err) {
      console.error('Erreur PUT /api/suppliers/:id :', err);

      if (err.code === '23505') {
        return res.status(400).json({ error: 'Code fournisseur déjà existant' });
      }

      res.status(500).json({ error: 'Erreur serveur modification fournisseur' });
    }
  }
);

router.patch(
  '/suppliers/:id/status',
  authenticateToken,
  attachDbContext,
  requireRole(['admin', 'responsable']),
  async (req, res) => {
    try {
      const { status } = req.body;

      if (!['active', 'inactive', 'blocked'].includes(status)) {
        return res.status(400).json({ error: 'Statut fournisseur invalide' });
      }

      const result = await req.dbPool.query(
        `
        UPDATE suppliers
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
        return res.status(404).json({ error: 'Fournisseur introuvable' });
      }

      res.json(result.rows[0]);
    } catch (err) {
      console.error('Erreur PATCH /api/suppliers/:id/status :', err);
      res.status(500).json({ error: 'Erreur serveur statut fournisseur' });
    }
  }
);

router.delete(
  '/suppliers/:id',
  authenticateToken,
  attachDbContext,
  requireRole(['admin']),
  async (req, res) => {
    try {
      const result = await req.dbPool.query(
        `
        UPDATE suppliers
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
        return res.status(404).json({ error: 'Fournisseur introuvable' });
      }

      res.json({ ok: true, supplier: result.rows[0] });
    } catch (err) {
      console.error('Erreur DELETE /api/suppliers/:id :', err);
      res.status(500).json({ error: 'Erreur serveur suppression fournisseur' });
    }
  }
);

module.exports = router;