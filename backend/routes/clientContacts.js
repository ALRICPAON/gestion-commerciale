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

function mapContactPayload(body = {}) {
  return {
    label: clean(body.label),
    contact_name: clean(body.contact_name),
    role: clean(body.role),
    email: clean(body.email),
    phone: clean(body.phone),
    mobile: clean(body.mobile),
    receives_orders: bool(body.receives_orders),
    receives_delivery_notes: bool(body.receives_delivery_notes),
    receives_invoices: bool(body.receives_invoices),
    receives_statements: bool(body.receives_statements),
    is_default_for_orders: bool(body.is_default_for_orders),
    is_default_for_delivery_notes: bool(body.is_default_for_delivery_notes),
    is_default_for_invoices: bool(body.is_default_for_invoices),
    notes: clean(body.notes),
    status: clean(body.status) || 'active',
  };
}

async function ensureClient(req, clientId) {
  const result = await req.dbPool.query(
    `SELECT id FROM clients WHERE id = $1 AND store_id = $2 AND status <> 'inactive' LIMIT 1`,
    [clientId, req.user.store_id]
  );

  if (!result.rows.length) {
    const error = new Error('Client introuvable pour ce magasin');
    error.status = 404;
    throw error;
  }
}

async function clearDefaultFlags(db, { storeId, clientId, contactId, contact }) {
  const updates = [];

  if (contact.is_default_for_orders) {
    updates.push(
      db.query(
        `UPDATE client_contacts
         SET is_default_for_orders = false, updated_at = NOW()
         WHERE store_id = $1 AND client_id = $2 AND id <> $3`,
        [storeId, clientId, contactId]
      )
    );
  }

  if (contact.is_default_for_delivery_notes) {
    updates.push(
      db.query(
        `UPDATE client_contacts
         SET is_default_for_delivery_notes = false, updated_at = NOW()
         WHERE store_id = $1 AND client_id = $2 AND id <> $3`,
        [storeId, clientId, contactId]
      )
    );
  }

  if (contact.is_default_for_invoices) {
    updates.push(
      db.query(
        `UPDATE client_contacts
         SET is_default_for_invoices = false, updated_at = NOW()
         WHERE store_id = $1 AND client_id = $2 AND id <> $3`,
        [storeId, clientId, contactId]
      )
    );
  }

  await Promise.all(updates);
}

router.get('/clients/:clientId/contacts', authenticateToken, attachDbContext, async (req, res) => {
  try {
    await ensureClient(req, req.params.clientId);

    const result = await req.dbPool.query(
      `SELECT *
       FROM client_contacts
       WHERE store_id = $1 AND client_id = $2
       ORDER BY
         CASE WHEN status = 'active' THEN 0 ELSE 1 END,
         is_default_for_invoices DESC,
         is_default_for_delivery_notes DESC,
         is_default_for_orders DESC,
         contact_name ASC`,
      [req.user.store_id, req.params.clientId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur GET /api/clients/:clientId/contacts :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur serveur contacts client' });
  }
});

router.post('/clients/:clientId/contacts', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const db = await req.dbPool.connect();

  try {
    await db.query('BEGIN');
    await ensureClient(req, req.params.clientId);

    const contact = mapContactPayload(req.body);
    if (!contact.contact_name) {
      await db.query('ROLLBACK');
      return res.status(400).json({ error: 'Nom du contact obligatoire' });
    }

    if (!['active', 'inactive'].includes(contact.status)) contact.status = 'active';

    const created = await db.query(
      `INSERT INTO client_contacts (
        store_id, client_id, label, contact_name, role, email, phone, mobile,
        receives_orders, receives_delivery_notes, receives_invoices, receives_statements,
        is_default_for_orders, is_default_for_delivery_notes, is_default_for_invoices,
        notes, status, created_by, updated_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12,
        $13, $14, $15,
        $16, $17, $18, $18
      )
      RETURNING *`,
      [
        req.user.store_id,
        req.params.clientId,
        contact.label,
        contact.contact_name,
        contact.role,
        contact.email,
        contact.phone,
        contact.mobile,
        contact.receives_orders,
        contact.receives_delivery_notes,
        contact.receives_invoices,
        contact.receives_statements,
        contact.is_default_for_orders,
        contact.is_default_for_delivery_notes,
        contact.is_default_for_invoices,
        contact.notes,
        contact.status,
        req.user.id,
      ]
    );

    await clearDefaultFlags(db, {
      storeId: req.user.store_id,
      clientId: req.params.clientId,
      contactId: created.rows[0].id,
      contact,
    });

    await db.query('COMMIT');
    res.status(201).json(created.rows[0]);
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Erreur POST /api/clients/:clientId/contacts :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur création contact client' });
  } finally {
    db.release();
  }
});

router.put('/clients/:clientId/contacts/:contactId', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  const db = await req.dbPool.connect();

  try {
    await db.query('BEGIN');
    await ensureClient(req, req.params.clientId);

    const contact = mapContactPayload(req.body);
    if (!contact.contact_name) {
      await db.query('ROLLBACK');
      return res.status(400).json({ error: 'Nom du contact obligatoire' });
    }

    if (!['active', 'inactive'].includes(contact.status)) contact.status = 'active';

    const updated = await db.query(
      `UPDATE client_contacts
       SET label = $1,
           contact_name = $2,
           role = $3,
           email = $4,
           phone = $5,
           mobile = $6,
           receives_orders = $7,
           receives_delivery_notes = $8,
           receives_invoices = $9,
           receives_statements = $10,
           is_default_for_orders = $11,
           is_default_for_delivery_notes = $12,
           is_default_for_invoices = $13,
           notes = $14,
           status = $15,
           updated_by = $16,
           updated_at = NOW()
       WHERE id = $17 AND client_id = $18 AND store_id = $19
       RETURNING *`,
      [
        contact.label,
        contact.contact_name,
        contact.role,
        contact.email,
        contact.phone,
        contact.mobile,
        contact.receives_orders,
        contact.receives_delivery_notes,
        contact.receives_invoices,
        contact.receives_statements,
        contact.is_default_for_orders,
        contact.is_default_for_delivery_notes,
        contact.is_default_for_invoices,
        contact.notes,
        contact.status,
        req.user.id,
        req.params.contactId,
        req.params.clientId,
        req.user.store_id,
      ]
    );

    if (!updated.rows.length) {
      await db.query('ROLLBACK');
      return res.status(404).json({ error: 'Contact introuvable' });
    }

    await clearDefaultFlags(db, {
      storeId: req.user.store_id,
      clientId: req.params.clientId,
      contactId: req.params.contactId,
      contact,
    });

    await db.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Erreur PUT /api/clients/:clientId/contacts/:contactId :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur modification contact client' });
  } finally {
    db.release();
  }
});

router.delete('/clients/:clientId/contacts/:contactId', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    await ensureClient(req, req.params.clientId);

    const result = await req.dbPool.query(
      `UPDATE client_contacts
       SET status = 'inactive', updated_by = $1, updated_at = NOW()
       WHERE id = $2 AND client_id = $3 AND store_id = $4
       RETURNING id, status`,
      [req.user.id, req.params.contactId, req.params.clientId, req.user.store_id]
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Contact introuvable' });

    res.json({ ok: true, contact: result.rows[0] });
  } catch (err) {
    console.error('Erreur DELETE /api/clients/:clientId/contacts/:contactId :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur suppression contact client' });
  }
});

module.exports = router;