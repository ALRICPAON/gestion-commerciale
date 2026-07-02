const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');
const { testPennylaneConnection } = require('../services/pennylane');
const { enqueuePennylaneSync } = require('../services/pennylane/syncQueue');

const router = express.Router();

const MANUAL_SYNC_PRIORITY = 40;
const FINALIZED_INVOICE_STATUSES = ['validated', 'finalized', 'sent', 'paid', 'partially_paid', 'overdue'];

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(String(value || ''));
}

function normalizeEntityType(value) {
  const text = String(value || '').trim().toLowerCase();
  if (['client', 'customer'].includes(text)) return 'client';
  if (['supplier', 'fournisseur'].includes(text)) return 'supplier';
  if (['customer_invoice', 'invoice', 'facture_client'].includes(text)) return 'customer_invoice';
  if (['supplier_invoice', 'facture_fournisseur'].includes(text)) return 'supplier_invoice';
  return null;
}

function buildExternalReference(storeId, entityType, entityId) {
  return `alta:${storeId}:${entityType}:${entityId}`;
}

function buildManualPayload(row, entityType) {
  const externalReference = buildExternalReference(row.store_id, entityType, row.id);

  if (entityType === 'client') {
    return {
      client_id: row.id,
      code: row.code,
      name: row.name,
      legal_name: row.legal_name,
      email: row.email,
      phone: row.phone || row.mobile,
      vat_number: row.vat_number,
      siret: row.siret,
      status: row.status,
      manual: true,
      external_reference: externalReference,
    };
  }

  if (entityType === 'supplier') {
    return {
      supplier_id: row.id,
      code: row.code,
      name: row.name,
      legal_name: row.legal_name,
      email: row.email,
      phone: row.phone || row.mobile,
      vat_number: row.vat_number,
      siret: row.siret,
      status: row.status,
      manual: true,
      external_reference: externalReference,
    };
  }

  return {
    invoice_id: row.id,
    reference_number: row.reference_number,
    status: row.status,
    manual: true,
    external_reference: externalReference,
  };
}

async function fetchManualSyncEntity(db, { entityType, entityId, storeId }) {
  if (entityType === 'client') {
    const result = await db.query(
      `
      SELECT id, store_id, code, name, legal_name, email, phone, mobile, vat_number, siret,
        status, pennylane_customer_id
      FROM clients
      WHERE id = $1
        AND store_id = $2
      LIMIT 1
      `,
      [entityId, storeId]
    );
    return result.rows[0] || null;
  }

  if (entityType === 'supplier') {
    const result = await db.query(
      `
      SELECT id, store_id, code, name, legal_name, email, phone, mobile, vat_number, siret,
        status, pennylane_supplier_id
      FROM suppliers
      WHERE id = $1
        AND store_id = $2
      LIMIT 1
      `,
      [entityId, storeId]
    );
    return result.rows[0] || null;
  }

  if (entityType === 'customer_invoice') {
    const result = await db.query(
      `
      SELECT id, store_id, reference_number, status, pennylane_invoice_id
      FROM sales_documents
      WHERE id = $1
        AND store_id = $2
        AND document_type = 'INVOICE'
      LIMIT 1
      `,
      [entityId, storeId]
    );
    return result.rows[0] || null;
  }

  return null;
}

function manualActionFor(entityType, row) {
  if (entityType === 'client') {
    return row.pennylane_customer_id ? 'client.update' : 'client.create';
  }

  if (entityType === 'supplier') {
    return row.pennylane_supplier_id ? 'supplier.update' : 'supplier.create';
  }

  return row.pennylane_invoice_id ? 'customer_invoice.update' : 'customer_invoice.create';
}

async function markEntityPending(db, { entityType, entityId, storeId }) {
  if (entityType === 'client') {
    await db.query(
      `
      UPDATE clients
      SET pennylane_sync_status = 'pending',
        pennylane_sync_last_error = NULL,
        pennylane_sync_updated_at = now()
      WHERE id = $1
        AND store_id = $2
      `,
      [entityId, storeId]
    );
    return;
  }

  if (entityType === 'supplier') {
    await db.query(
      `
      UPDATE suppliers
      SET pennylane_sync_status = 'pending',
        pennylane_sync_last_error = NULL,
        pennylane_sync_updated_at = now()
      WHERE id = $1
        AND store_id = $2
      `,
      [entityId, storeId]
    );
    return;
  }

  await db.query(
    `
    UPDATE sales_documents
    SET pennylane_sync_status = 'pending',
      pennylane_sync_last_error = NULL,
      pennylane_sync_updated_at = now()
    WHERE id = $1
      AND store_id = $2
      AND document_type = 'INVOICE'
    `,
    [entityId, storeId]
  );
}

router.get('/integrations/pennylane/test', authenticateToken, requireAdminOrManager, async (req, res) => {
  try {
    const result = await testPennylaneConnection();

    if (result.connected) {
      console.info('Test connexion Pennylane OK', {
        environment: result.environment,
        user_id: req.user.id,
        store_id: req.user.store_id,
      });
    } else {
      console.warn('Test connexion Pennylane KO', {
        environment: result.environment,
        user_id: req.user.id,
        store_id: req.user.store_id,
        message: result.message,
      });
    }

    return res.json(result);
  } catch (err) {
    console.error('Erreur GET /api/integrations/pennylane/test :', err);
    return res.status(500).json({
      connected: false,
      environment: process.env.PENNYLANE_ENV || 'sandbox',
      message: 'Erreur serveur pendant le test Pennylane.',
      pennylane_response: null,
    });
  }
});

router.post('/integrations/pennylane/sync/:entityType/:entityId', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const entityType = normalizeEntityType(req.params.entityType);
    const entityId = req.params.entityId;

    if (!entityType || !isUuid(entityId)) {
      return res.status(400).json({ error: 'Demande de synchronisation Pennylane invalide' });
    }

    if (entityType === 'supplier_invoice') {
      return res.status(501).json({ error: 'Synchronisation facture fournisseur pas encore activee' });
    }

    const entity = await fetchManualSyncEntity(req.dbPool, {
      entityType,
      entityId,
      storeId: req.user.store_id,
    });

    if (!entity) {
      return res.status(404).json({ error: 'Element introuvable pour ce magasin' });
    }

    if (entityType === 'customer_invoice' && !FINALIZED_INVOICE_STATUSES.includes(String(entity.status || '').toLowerCase())) {
      return res.status(400).json({ error: 'Seules les factures clients finalisees peuvent etre synchronisees' });
    }

    const action = manualActionFor(entityType, entity);
    const queue = await enqueuePennylaneSync(req.dbPool, {
      storeId: req.user.store_id,
      entityType,
      entityId,
      action,
      payload: buildManualPayload(entity, entityType),
      priority: MANUAL_SYNC_PRIORITY,
      createdBy: req.user.id,
    });

    await markEntityPending(req.dbPool, { entityType, entityId, storeId: req.user.store_id });

    return res.status(202).json({
      ok: true,
      queued: true,
      queue_id: queue.id,
      reused: queue.reused,
      entity_type: entityType,
      action,
    });
  } catch (err) {
    console.error('Erreur POST /api/integrations/pennylane/sync :', err);
    return res.status(500).json({ error: 'Erreur mise en queue synchronisation Pennylane' });
  }
});

router.get('/integrations/pennylane/customer-invoices', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const params = [req.user.store_id];
    const where = ["inv.store_id = $1", "inv.document_type = 'INVOICE'"];

    if (req.query.client_id && isUuid(req.query.client_id)) {
      params.push(req.query.client_id);
      where.push(`COALESCE(inv.billed_client_id, inv.client_id) = $${params.length}`);
    }

    if (req.query.from) {
      params.push(req.query.from);
      where.push(`inv.document_date >= $${params.length}::date`);
    }

    if (req.query.to) {
      params.push(req.query.to);
      where.push(`inv.document_date <= $${params.length}::date`);
    }

    if (req.query.payment_status && req.query.payment_status !== 'all') {
      params.push(req.query.payment_status);
      where.push(`COALESCE(inv.pennylane_payment_status, 'unpaid') = $${params.length}`);
    }

    if (req.query.sync_status && req.query.sync_status !== 'all') {
      params.push(req.query.sync_status);
      where.push(`COALESCE(inv.pennylane_sync_status, 'pending') = $${params.length}`);
    }

    if (req.query.overdue === 'true') {
      where.push("COALESCE(inv.pennylane_payment_status, 'unpaid') NOT IN ('paid') AND inv.document_date < CURRENT_DATE");
    }

    const result = await req.dbPool.query(
      `
      SELECT
        inv.id,
        inv.reference_number,
        inv.document_date,
        NULL::date AS deadline,
        inv.total_amount_inc_vat,
        inv.status AS alta_status,
        inv.pennylane_invoice_id,
        inv.pennylane_invoice_number,
        inv.pennylane_sync_status,
        inv.pennylane_sync_last_error,
        inv.pennylane_synced_at,
        inv.pennylane_payment_status,
        inv.pennylane_paid_amount,
        inv.pennylane_remaining_amount,
        inv.pennylane_paid_at,
        inv.pennylane_status,
        inv.pennylane_last_status_synced_at,
        COALESCE(inv.billed_client_id, inv.client_id) AS client_id,
        COALESCE(inv.billed_client_name_snapshot, billed.name, delivered.name) AS client_name,
        COALESCE(inv.billed_client_code_snapshot, billed.code, delivered.code) AS client_code,
        (
          COALESCE(inv.pennylane_payment_status, 'unpaid') NOT IN ('paid')
          AND inv.document_date < CURRENT_DATE
        ) AS is_overdue
      FROM sales_documents inv
      LEFT JOIN clients billed
        ON billed.id = inv.billed_client_id
       AND billed.store_id = inv.store_id
      LEFT JOIN clients delivered
        ON delivered.id = inv.client_id
       AND delivered.store_id = inv.store_id
      WHERE ${where.join(' AND ')}
      ORDER BY inv.document_date DESC, inv.reference_number DESC
      LIMIT 300
      `,
      params
    );

    return res.json({ invoices: result.rows });
  } catch (err) {
    console.error('Erreur GET /api/integrations/pennylane/customer-invoices :', err);
    return res.status(500).json({ error: 'Erreur liste factures clients Pennylane' });
  }
});

module.exports = router;
