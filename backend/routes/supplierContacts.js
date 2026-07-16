const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');

const router = express.Router();

const clean = (value) => (value === undefined || value === null ? null : String(value).trim() || null);

const bool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on', 'oui'].includes(text)) return true;
  if (['false', '0', 'no', 'off', 'non'].includes(text)) return false;
  return fallback;
};

function normalizeEmail(value) {
  const email = clean(value);
  if (!email) return null;
  const normalized = email.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    const error = new Error('Adresse email invalide');
    error.status = 400;
    error.expose = true;
    throw error;
  }
  return normalized;
}

function mapContactPayload(body = {}) {
  return {
    label: clean(body.label),
    contact_name: clean(body.contact_name),
    first_name: clean(body.first_name),
    last_name: clean(body.last_name),
    role: clean(body.role),
    email: normalizeEmail(body.email),
    phone: clean(body.phone),
    mobile: clean(body.mobile),
    receives_purchase_orders: bool(body.receives_purchase_orders),
    receives_price_requests: bool(body.receives_price_requests),
    receives_delivery_claims: bool(body.receives_delivery_claims),
    receives_accounting_documents: bool(body.receives_accounting_documents),
    is_primary: bool(body.is_primary),
    notes: clean(body.notes),
    status: clean(body.status) || 'active',
  };
}

async function ensureSupplier(req, supplierId) {
  const result = await req.dbPool.query(
    `SELECT id FROM suppliers WHERE id = $1 AND store_id = $2 AND status <> 'inactive' LIMIT 1`,
    [supplierId, req.user.store_id]
  );

  if (!result.rows.length) {
    const error = new Error('Fournisseur introuvable pour ce magasin');
    error.status = 404;
    throw error;
  }
}

async function clearPrimaryFlag(db, { storeId, supplierId, contactId, contact }) {
  if (!contact.is_primary) return;
  await db.query(
    `UPDATE supplier_contacts
     SET is_primary = false, updated_at = NOW()
     WHERE store_id = $1 AND supplier_id = $2 AND id <> $3`,
    [storeId, supplierId, contactId]
  );
}

router.get('/suppliers/:supplierId/contacts', authenticateToken, attachDbContext, async (req, res) => {
  try {
    await ensureSupplier(req, req.params.supplierId);

    const result = await req.dbPool.query(
      `SELECT *
       FROM supplier_contacts
       WHERE store_id = $1 AND supplier_id = $2
       ORDER BY
         CASE WHEN status = 'active' THEN 0 ELSE 1 END,
         is_primary DESC,
         contact_name ASC`,
      [req.user.store_id, req.params.supplierId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur GET /api/suppliers/:supplierId/contacts :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur serveur contacts fournisseur' });
  }
});

router.post('/suppliers/:supplierId/contacts', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const db = await req.dbPool.connect();

  try {
    await db.query('BEGIN');
    await ensureSupplier(req, req.params.supplierId);

    const contact = mapContactPayload(req.body);
    if (!contact.contact_name) {
      await db.query('ROLLBACK');
      return res.status(400).json({ error: 'Nom du contact obligatoire' });
    }
    if (!['active', 'inactive'].includes(contact.status)) contact.status = 'active';

    const created = await db.query(
      `INSERT INTO supplier_contacts (
        store_id, supplier_id, label, contact_name, first_name, last_name, role, email, phone, mobile,
        receives_purchase_orders, receives_price_requests, receives_delivery_claims, receives_accounting_documents,
        is_primary, notes, status, created_by, updated_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14,
        $15, $16, $17, $18, $18
      )
      RETURNING *`,
      [
        req.user.store_id,
        req.params.supplierId,
        contact.label,
        contact.contact_name,
        contact.first_name,
        contact.last_name,
        contact.role,
        contact.email,
        contact.phone,
        contact.mobile,
        contact.receives_purchase_orders,
        contact.receives_price_requests,
        contact.receives_delivery_claims,
        contact.receives_accounting_documents,
        contact.is_primary,
        contact.notes,
        contact.status,
        req.user.id,
      ]
    );

    await clearPrimaryFlag(db, {
      storeId: req.user.store_id,
      supplierId: req.params.supplierId,
      contactId: created.rows[0].id,
      contact,
    });

    await db.query('COMMIT');
    res.status(201).json(created.rows[0]);
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Erreur POST /api/suppliers/:supplierId/contacts :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur creation contact fournisseur' });
  } finally {
    db.release();
  }
});

router.put('/suppliers/:supplierId/contacts/:contactId', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const db = await req.dbPool.connect();

  try {
    await db.query('BEGIN');
    await ensureSupplier(req, req.params.supplierId);

    const contact = mapContactPayload(req.body);
    if (!contact.contact_name) {
      await db.query('ROLLBACK');
      return res.status(400).json({ error: 'Nom du contact obligatoire' });
    }
    if (!['active', 'inactive'].includes(contact.status)) contact.status = 'active';

    const updated = await db.query(
      `UPDATE supplier_contacts
       SET label = $1,
           contact_name = $2,
           first_name = $3,
           last_name = $4,
           role = $5,
           email = $6,
           phone = $7,
           mobile = $8,
           receives_purchase_orders = $9,
           receives_price_requests = $10,
           receives_delivery_claims = $11,
           receives_accounting_documents = $12,
           is_primary = $13,
           notes = $14,
           status = $15,
           updated_by = $16,
           updated_at = NOW()
       WHERE id = $17 AND supplier_id = $18 AND store_id = $19
       RETURNING *`,
      [
        contact.label,
        contact.contact_name,
        contact.first_name,
        contact.last_name,
        contact.role,
        contact.email,
        contact.phone,
        contact.mobile,
        contact.receives_purchase_orders,
        contact.receives_price_requests,
        contact.receives_delivery_claims,
        contact.receives_accounting_documents,
        contact.is_primary,
        contact.notes,
        contact.status,
        req.user.id,
        req.params.contactId,
        req.params.supplierId,
        req.user.store_id,
      ]
    );

    if (!updated.rows.length) {
      await db.query('ROLLBACK');
      return res.status(404).json({ error: 'Contact introuvable' });
    }

    await clearPrimaryFlag(db, {
      storeId: req.user.store_id,
      supplierId: req.params.supplierId,
      contactId: req.params.contactId,
      contact,
    });

    await db.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Erreur PUT /api/suppliers/:supplierId/contacts/:contactId :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur modification contact fournisseur' });
  } finally {
    db.release();
  }
});

router.delete('/suppliers/:supplierId/contacts/:contactId', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    await ensureSupplier(req, req.params.supplierId);

    const result = await req.dbPool.query(
      `UPDATE supplier_contacts
       SET status = 'inactive', updated_by = $1, updated_at = NOW()
       WHERE id = $2 AND supplier_id = $3 AND store_id = $4
       RETURNING id, status`,
      [req.user.id, req.params.contactId, req.params.supplierId, req.user.store_id]
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Contact introuvable' });

    res.json({ ok: true, contact: result.rows[0] });
  } catch (err) {
    console.error('Erreur DELETE /api/suppliers/:supplierId/contacts/:contactId :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur suppression contact fournisseur' });
  }
});

module.exports = router;
