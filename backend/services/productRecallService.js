const {
  ALREADY_BLOCKED_CODE,
  STATUS_BLOCKED,
  blockLotForQuality,
} = require('./quality/lotBlocking');
const {
  createOrGetQualityEvent,
  createOrGetQualityEvidenceRecord,
} = require('./quality/events');

const ACTIVE_CAMPAIGN_STATUSES = ['draft', 'ready', 'sending', 'sent', 'partial'];
const ACTIVE_CAMPAIGN_UNIQUE_INDEX = 'uq_product_recall_active_lot';
const RECALL_TYPES = new Set([
  'supplier_recall',
  'health_alert',
  'quality_suspicion',
  'authority_request',
  'traceability_issue',
  'other',
]);

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function toNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function makeError(message, status, code, details = null) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  if (details) error.details = details;
  return error;
}

function isActiveCampaignUniqueViolation(error) {
  return Boolean(
    error
    && error.code === '23505'
    && error.constraint === ACTIVE_CAMPAIGN_UNIQUE_INDEX
  );
}

function activeCampaignExistsError(details = null) {
  return makeError('Une campagne de retrait/rappel est déjà active pour ce lot', 409, 'PRODUCT_RECALL_ACTIVE_EXISTS', details);
}

function assertRecallDraftInput({ storeId, lotId, recallType, reason, comment }) {
  if (!isUuid(storeId)) throw makeError('Magasin invalide', 400, 'INVALID_STORE');
  if (!isUuid(lotId)) throw makeError('ID lot invalide', 400, 'INVALID_LOT');
  if (!RECALL_TYPES.has(recallType)) throw makeError('Type de rappel invalide', 400, 'INVALID_RECALL_TYPE');
  if (!reason) throw makeError('Motif de rappel obligatoire', 400, 'RECALL_REASON_REQUIRED');
  if (recallType === 'other' && !comment) {
    throw makeError('Commentaire obligatoire pour un rappel autre', 400, 'RECALL_COMMENT_REQUIRED');
  }
}

async function fetchLot(db, storeId, lotId) {
  const result = await db.query(
    `SELECT
       l.id AS lot_id,
       l.store_id,
       l.lot_code,
       l.supplier_lot_number,
       l.article_id,
       l.qty_initial,
       l.qty_remaining,
       COALESCE(l.quality_status, 'available') AS quality_status,
       l.quality_block_reason,
       l.quality_block_reason_type,
       l.quality_block_comment,
       l.quality_blocked_at,
       l.quality_non_conformity_id,
       a.plu AS article_plu,
       a.designation AS article_label,
       a.unit AS article_unit,
       a.family_name
     FROM lots l
     JOIN articles a ON a.id = l.article_id AND a.store_id = l.store_id
     WHERE l.store_id = $1::uuid
       AND l.id = $2::uuid
     LIMIT 1`,
    [storeId, lotId]
  );
  return result.rows[0] || null;
}

async function fetchDeliveryRows(db, storeId, lotId) {
  const result = await db.query(
    `SELECT
       sd.id AS delivery_note_id,
       sd.reference_number AS delivery_note_reference,
       sd.document_date AS delivery_note_date,
       sd.document_type,
       delivered.id AS delivered_client_id,
       COALESCE(sd.delivered_client_name_snapshot, delivered.name) AS delivered_client_name,
       COALESCE(sd.delivered_client_code_snapshot, delivered.code) AS delivered_client_code,
       COALESCE(sd.delivered_client_store_identifier, delivered.store_identifier) AS delivered_client_store_identifier,
       billed.id AS billed_client_id,
       COALESCE(sd.billed_client_name_snapshot, billed.name) AS billed_client_name,
       COALESCE(sd.billed_client_code_snapshot, billed.code) AS billed_client_code,
       SUM(sla.quantity) AS delivered_quantity,
       MIN(sla.created_at) AS allocated_at
     FROM sale_line_allocations sla
     JOIN sales_lines sl ON sl.id = sla.sales_line_id AND sl.store_id = $1::uuid
     JOIN sales_documents sd ON sd.id = sl.sales_document_id AND sd.store_id = sl.store_id
     LEFT JOIN clients delivered ON delivered.id = sd.client_id AND delivered.store_id = sd.store_id
     LEFT JOIN clients billed ON billed.id = COALESCE(sd.billed_client_id, delivered.billed_client_id, sd.client_id) AND billed.store_id = sd.store_id
     WHERE sla.lot_id = $2::uuid
       AND sd.store_id = $1::uuid
       AND delivered.id IS NOT NULL
     GROUP BY
       sd.id,
       sd.reference_number,
       sd.document_date,
       sd.document_type,
       sd.delivered_client_name_snapshot,
       sd.delivered_client_code_snapshot,
       sd.delivered_client_store_identifier,
       sd.billed_client_name_snapshot,
       sd.billed_client_code_snapshot,
       delivered.id,
       delivered.name,
       delivered.code,
       delivered.store_identifier,
       billed.id,
       billed.name,
       billed.code
     ORDER BY delivered.name ASC NULLS LAST, sd.document_date ASC, sd.reference_number ASC NULLS LAST`,
    [storeId, lotId]
  );
  return result.rows;
}

async function resolveRecallContact(db, storeId, clientId) {
  const deliveryNoteContact = await db.query(
    `SELECT id, contact_name, email
     FROM client_contacts
     WHERE store_id = $1::uuid
       AND client_id = $2::uuid
       AND COALESCE(status, 'active') = 'active'
       AND receives_delivery_notes = true
       AND NULLIF(btrim(email), '') IS NOT NULL
     ORDER BY is_primary DESC, contact_name ASC NULLS LAST, id ASC
     LIMIT 1`,
    [storeId, clientId]
  );
  if (deliveryNoteContact.rows[0]) {
    return { ...deliveryNoteContact.rows[0], contact_source: 'delivery_note_contact' };
  }

  const primaryContact = await db.query(
    `SELECT id, contact_name, email
     FROM client_contacts
     WHERE store_id = $1::uuid
       AND client_id = $2::uuid
       AND COALESCE(status, 'active') = 'active'
       AND is_primary = true
       AND NULLIF(btrim(email), '') IS NOT NULL
     ORDER BY contact_name ASC NULLS LAST, id ASC
     LIMIT 1`,
    [storeId, clientId]
  );
  if (primaryContact.rows[0]) {
    return { ...primaryContact.rows[0], contact_source: 'primary_contact' };
  }

  const clientEmail = await db.query(
    `SELECT id, name AS contact_name, email
     FROM clients
     WHERE store_id = $1::uuid
       AND id = $2::uuid
       AND NULLIF(btrim(email), '') IS NOT NULL
     LIMIT 1`,
    [storeId, clientId]
  );
  if (clientEmail.rows[0]) {
    return { id: null, contact_name: clientEmail.rows[0].contact_name, email: clientEmail.rows[0].email, contact_source: 'client_email' };
  }

  return null;
}

function mapLot(row) {
  return {
    lot_id: row.lot_id,
    lot_code: row.lot_code,
    supplier_lot_number: row.supplier_lot_number || null,
    qty_initial: toNumber(row.qty_initial),
    stock_remaining: toNumber(row.qty_remaining),
    quality: {
      status: row.quality_status || 'available',
      block_reason: row.quality_block_reason || null,
      block_reason_type: row.quality_block_reason_type || null,
      block_comment: row.quality_block_comment || null,
      blocked_at: row.quality_blocked_at || null,
      non_conformity_id: row.quality_non_conformity_id || null,
    },
  };
}

function mapArticle(row) {
  return {
    article_id: row.article_id,
    plu: row.article_plu || null,
    designation: row.article_label || null,
    unit: row.article_unit || null,
    family_name: row.family_name || null,
  };
}

async function aggregateRecipients(db, storeId, deliveryRows) {
  const byClient = new Map();
  deliveryRows.forEach((row) => {
    if (!row.delivered_client_id) return;
    const clientId = row.delivered_client_id;
    if (!byClient.has(clientId)) {
      byClient.set(clientId, {
        delivered_client_id: clientId,
        delivered_client_name: row.delivered_client_name || null,
        delivered_client_code: row.delivered_client_code || null,
        delivered_client_store_identifier: row.delivered_client_store_identifier || null,
        delivered_quantity: 0,
        delivery_note_count: 0,
        delivery_notes: [],
      });
    }

    const recipient = byClient.get(clientId);
    const quantity = toNumber(row.delivered_quantity);
    recipient.delivered_quantity += quantity;
    recipient.delivery_note_count += 1;
    recipient.delivery_notes.push({
      delivery_note_id: row.delivery_note_id,
      reference: row.delivery_note_reference || null,
      date: row.delivery_note_date || null,
      document_type: row.document_type || null,
      delivered_quantity: quantity,
      billed_client_id: row.billed_client_id || null,
      billed_client_name: row.billed_client_name || null,
      billed_client_code: row.billed_client_code || null,
      allocated_at: row.allocated_at || null,
    });
  });

  const recipients = [];
  for (const recipient of byClient.values()) {
    const contact = await resolveRecallContact(db, storeId, recipient.delivered_client_id);
    recipients.push({
      ...recipient,
      email: contact ? clean(contact.email) : null,
      contact_id: contact ? contact.id || null : null,
      contact_name: contact ? contact.contact_name || null : null,
      contact_source: contact ? contact.contact_source : null,
      status: contact && clean(contact.email) ? 'ready' : 'contact_required',
    });
  }

  return recipients.sort((left, right) => {
    const nameOrder = String(left.delivered_client_name || '').localeCompare(String(right.delivered_client_name || ''), 'fr');
    if (nameOrder !== 0) return nameOrder;
    return String(left.delivered_client_id).localeCompare(String(right.delivered_client_id));
  });
}

async function analyzeLotRecallImpact({ db, storeId, lotId } = {}) {
  if (!db || typeof db.query !== 'function') throw makeError('Connexion base invalide', 500, 'INVALID_DB');
  if (!isUuid(storeId)) throw makeError('Magasin invalide', 400, 'INVALID_STORE');
  if (!isUuid(lotId)) throw makeError('ID lot invalide', 400, 'INVALID_LOT');

  const lotRow = await fetchLot(db, storeId, lotId);
  if (!lotRow) throw makeError('Lot introuvable pour ce magasin', 404, 'LOT_NOT_FOUND');

  const deliveryRows = await fetchDeliveryRows(db, storeId, lotId);
  const recipients = await aggregateRecipients(db, storeId, deliveryRows);

  return {
    lot: mapLot(lotRow),
    article: mapArticle(lotRow),
    stock_remaining: toNumber(lotRow.qty_remaining),
    clients_count: recipients.length,
    delivery_notes_count: recipients.reduce((sum, recipient) => sum + recipient.delivery_note_count, 0),
    total_delivered_quantity: recipients.reduce((sum, recipient) => sum + recipient.delivered_quantity, 0),
    recipients,
  };
}

function buildEventPayload({ campaign, analysis, recallType, reason, comment, lotAlreadyBlocked }) {
  return {
    campaign_id: campaign.id,
    recall_type: recallType,
    reason,
    comment,
    status: campaign.status,
    lot: analysis.lot,
    article: analysis.article,
    impact: {
      stock_remaining: analysis.stock_remaining,
      clients_count: analysis.clients_count,
      delivery_notes_count: analysis.delivery_notes_count,
      total_delivered_quantity: analysis.total_delivered_quantity,
      ready_recipients_count: analysis.recipients.filter((recipient) => recipient.status === 'ready').length,
      contact_required_count: analysis.recipients.filter((recipient) => recipient.status === 'contact_required').length,
    },
    lot_block: {
      source_type: 'product_recall',
      already_blocked: lotAlreadyBlocked,
      overwrite_existing_block: false,
    },
  };
}

function buildEvidencePayload({ campaign, analysis, recallType, reason, comment, lotAlreadyBlocked }) {
  return {
    campaign: {
      id: campaign.id,
      status: campaign.status,
      recall_type: recallType,
      reason,
      comment,
      initiated_at: campaign.initiated_at || null,
      prepared_at: campaign.prepared_at || null,
    },
    lot: analysis.lot,
    article: analysis.article,
    impact: {
      stock_remaining: analysis.stock_remaining,
      clients_count: analysis.clients_count,
      delivery_notes_count: analysis.delivery_notes_count,
      total_delivered_quantity: analysis.total_delivered_quantity,
      ready_recipients_count: analysis.recipients.filter((recipient) => recipient.status === 'ready').length,
      contact_required_count: analysis.recipients.filter((recipient) => recipient.status === 'contact_required').length,
    },
    recipients: analysis.recipients.map((recipient) => ({
      delivered_client_id: recipient.delivered_client_id,
      delivered_client_name: recipient.delivered_client_name,
      delivered_client_code: recipient.delivered_client_code,
      delivered_client_store_identifier: recipient.delivered_client_store_identifier,
      email: recipient.email,
      contact_id: recipient.contact_id,
      contact_name: recipient.contact_name,
      contact_source: recipient.contact_source,
      status: recipient.status,
      delivered_quantity: recipient.delivered_quantity,
      delivery_note_count: recipient.delivery_note_count,
      delivery_notes: recipient.delivery_notes,
    })),
    lot_block: {
      source_type: 'product_recall',
      already_blocked: lotAlreadyBlocked,
      overwrite_existing_block: false,
    },
  };
}

async function assertNoActiveCampaign(db, storeId, lotId) {
  const existing = await getActiveCampaign(db, storeId, lotId);
  if (existing) {
    throw activeCampaignExistsError({
      campaign_id: existing.id,
      status: existing.status,
    });
  }
}

async function getActiveCampaign(db, storeId, lotId) {
  const result = await db.query(
    `SELECT id, status
     FROM product_recall_campaigns
     WHERE store_id = $1::uuid
       AND lot_id = $2::uuid
       AND status = ANY($3::text[])
     ORDER BY initiated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
     LIMIT 1`,
    [storeId, lotId, ACTIVE_CAMPAIGN_STATUSES]
  );
  return result.rows[0] || null;
}

async function getProductRecallCampaign({ db, storeId, campaignId } = {}) {
  if (!db || typeof db.query !== 'function') throw makeError('Connexion base invalide', 500, 'INVALID_DB');
  if (!isUuid(storeId)) throw makeError('Magasin invalide', 400, 'INVALID_STORE');
  if (!isUuid(campaignId)) throw makeError('ID campagne invalide', 400, 'INVALID_RECALL_CAMPAIGN');

  const campaignResult = await db.query(
    `SELECT
       c.*,
       l.lot_code,
       l.supplier_lot_number,
       l.qty_initial,
       l.qty_remaining,
       COALESCE(l.quality_status, 'available') AS quality_status,
       l.quality_block_reason,
       l.quality_block_reason_type,
       l.quality_block_comment,
       l.quality_blocked_at,
       a.plu AS article_plu,
       a.designation AS article_label,
       a.unit AS article_unit,
       a.family_name,
       u.email AS initiated_by_email
     FROM product_recall_campaigns c
     JOIN lots l ON l.id = c.lot_id AND l.store_id = c.store_id
     LEFT JOIN articles a ON a.id = c.article_id AND a.store_id = c.store_id
     LEFT JOIN users u ON u.id = c.initiated_by
     WHERE c.store_id = $1::uuid
       AND c.id = $2::uuid
     LIMIT 1`,
    [storeId, campaignId]
  );
  const row = campaignResult.rows[0];
  if (!row) throw makeError('Rappel produit introuvable pour ce magasin', 404, 'PRODUCT_RECALL_NOT_FOUND');

  const recipientsResult = await db.query(
    `SELECT *
     FROM product_recall_recipients
     WHERE store_id = $1::uuid
       AND campaign_id = $2::uuid
     ORDER BY
       CASE status WHEN 'ready' THEN 1 WHEN 'contact_required' THEN 2 ELSE 3 END,
       delivered_client_name ASC NULLS LAST,
       delivered_client_id ASC`,
    [storeId, campaignId]
  );

  return {
    campaign: {
      id: row.id,
      store_id: row.store_id,
      lot_id: row.lot_id,
      article_id: row.article_id,
      status: row.status,
      recall_type: row.recall_type,
      reason: row.reason,
      comment: row.comment,
      initiated_by: row.initiated_by,
      initiated_by_email: row.initiated_by_email || null,
      initiated_at: row.initiated_at,
      prepared_at: row.prepared_at,
      sent_at: row.sent_at,
      closed_at: row.closed_at,
      quality_event_id: row.quality_event_id,
      quality_evidence_record_id: row.quality_evidence_record_id,
    },
    lot: {
      lot_id: row.lot_id,
      lot_code: row.lot_code,
      supplier_lot_number: row.supplier_lot_number || null,
      qty_initial: toNumber(row.qty_initial),
      stock_remaining: toNumber(row.qty_remaining),
      quality: {
        status: row.quality_status || 'available',
        block_reason: row.quality_block_reason || null,
        block_reason_type: row.quality_block_reason_type || null,
        block_comment: row.quality_block_comment || null,
        blocked_at: row.quality_blocked_at || null,
      },
    },
    article: {
      article_id: row.article_id,
      plu: row.article_plu || null,
      designation: row.article_label || null,
      unit: row.article_unit || null,
      family_name: row.family_name || null,
    },
    recipients: recipientsResult.rows.map((recipient) => ({
      id: recipient.id,
      delivered_client_id: recipient.delivered_client_id,
      delivered_client_name: recipient.delivered_client_name,
      delivered_client_code: recipient.delivered_client_code,
      delivered_client_store_identifier: recipient.delivered_client_store_identifier,
      email: recipient.email,
      contact_id: recipient.contact_id,
      contact_name: recipient.contact_name,
      contact_source: recipient.contact_source,
      status: recipient.status,
      delivered_quantity: toNumber(recipient.delivered_quantity),
      delivery_note_count: Number(recipient.delivery_note_count || 0),
      delivery_notes: Array.isArray(recipient.delivery_notes) ? recipient.delivery_notes : [],
      prepared_subject: recipient.prepared_subject || null,
      prepared_body: recipient.prepared_body || null,
      sent_at: recipient.sent_at || null,
      error_message: recipient.error_message || null,
    })),
  };
}

async function createProductRecallDraft({
  db,
  storeId,
  lotId,
  userId,
  recallType,
  reason,
  comment = null,
} = {}) {
  const normalized = {
    recallType: clean(recallType),
    reason: clean(reason),
    comment: clean(comment),
  };
  assertRecallDraftInput({ storeId, lotId, ...normalized });
  if (!isUuid(userId)) throw makeError('Utilisateur invalide', 400, 'INVALID_USER');

  await assertNoActiveCampaign(db, storeId, lotId);
  const analysis = await analyzeLotRecallImpact({ db, storeId, lotId });

  const idResult = await db.query('SELECT gen_random_uuid() AS id');
  const campaignId = idResult.rows[0] && idResult.rows[0].id;
  let lotAlreadyBlocked = analysis.lot.quality.status === STATUS_BLOCKED;
  if (!lotAlreadyBlocked) {
    try {
      await blockLotForQuality(db, {
        storeId,
        lotId,
        userId,
        reason: normalized.reason,
        reasonType: normalized.recallType,
        comment: normalized.comment,
        sourceType: 'product_recall',
        sourceId: campaignId,
      });
    } catch (error) {
      if (error.code !== ALREADY_BLOCKED_CODE) throw error;
      lotAlreadyBlocked = true;
    }
  }

  let campaignResult;
  try {
    campaignResult = await db.query(
      `INSERT INTO product_recall_campaigns (
         id, store_id, lot_id, article_id, status, recall_type, reason, comment,
         initiated_by, initiated_at, prepared_at, created_by, updated_by
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'draft', $5::text, $6::text, $7::text,
         $8::uuid, now(), now(), $8::uuid, $8::uuid
       )
       RETURNING *`,
      [
        campaignId,
        storeId,
        lotId,
        analysis.article.article_id,
        normalized.recallType,
        normalized.reason,
        normalized.comment,
        userId,
      ]
    );
  } catch (error) {
    if (!isActiveCampaignUniqueViolation(error)) throw error;
    const conflict = activeCampaignExistsError();
    conflict.cause = error;
    conflict.needsActiveCampaignLookup = true;
    throw conflict;
  }
  const campaign = campaignResult.rows[0];

  const recipients = [];
  for (const recipient of analysis.recipients) {
    const inserted = await db.query(
      `INSERT INTO product_recall_recipients (
         store_id, campaign_id, delivered_client_id,
         delivered_client_name, delivered_client_code, delivered_client_store_identifier,
         email, contact_id, contact_name, contact_source, status,
         delivered_quantity, delivery_note_count, delivery_notes,
         created_by, updated_by
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid,
         $4::text, $5::text, $6::text,
         $7::text, $8::uuid, $9::text, $10::text, $11::text,
         $12::numeric, $13::integer, $14::jsonb,
         $15::uuid, $15::uuid
       )
       RETURNING *`,
      [
        storeId,
        campaign.id,
        recipient.delivered_client_id,
        recipient.delivered_client_name,
        recipient.delivered_client_code,
        recipient.delivered_client_store_identifier,
        recipient.email,
        recipient.contact_id,
        recipient.contact_name,
        recipient.contact_source,
        recipient.status,
        recipient.delivered_quantity,
        recipient.delivery_note_count,
        JSON.stringify(recipient.delivery_notes),
        userId,
      ]
    );
    recipients.push(inserted.rows[0]);
  }

  const evidenceContext = {
    campaign,
    analysis,
    recallType: normalized.recallType,
    reason: normalized.reason,
    comment: normalized.comment,
    lotAlreadyBlocked,
  };
  const eventResult = await createOrGetQualityEvent({
    db,
    storeId,
    eventType: 'product_recall_initiated',
    sourceTable: 'product_recall_campaigns',
    sourceId: campaign.id,
    occurredAt: campaign.initiated_at || new Date(),
    triggeredBy: userId,
    eventStatus: 'recorded',
    payloadVersion: 1,
    payload: buildEventPayload(evidenceContext),
    userId,
  });

  const evidenceResult = await createOrGetQualityEvidenceRecord({
    db,
    storeId,
    qualityEventId: eventResult.event.id,
    evidenceType: 'product_recall_record',
    evidenceStatus: 'recorded',
    evidenceAt: campaign.prepared_at || campaign.initiated_at || new Date(),
    recordedBy: userId,
    sourceType: 'automatic',
    sourceRecordType: 'product_recall_campaigns',
    sourceRecordId: campaign.id,
    payloadVersion: 1,
    payload: buildEvidencePayload(evidenceContext),
    userId,
  });

  const updatedCampaign = await db.query(
    `UPDATE product_recall_campaigns
     SET quality_event_id = $3::uuid,
         quality_evidence_record_id = $4::uuid,
         updated_at = now(),
         updated_by = $5::uuid
     WHERE store_id = $1::uuid
       AND id = $2::uuid
     RETURNING *`,
    [storeId, campaign.id, eventResult.event.id, evidenceResult.evidence.id, userId]
  );

  return {
    campaign: updatedCampaign.rows[0] || campaign,
    recipients,
    analysis,
    quality_event: eventResult.event,
    quality_event_created: eventResult.created,
    quality_evidence_record: evidenceResult.evidence,
    quality_evidence_created: evidenceResult.created,
    lot_block: {
      source_type: 'product_recall',
      already_blocked: lotAlreadyBlocked,
      overwrite_existing_block: false,
    },
  };
}

module.exports = {
  ACTIVE_CAMPAIGN_STATUSES,
  ACTIVE_CAMPAIGN_UNIQUE_INDEX,
  RECALL_TYPES,
  analyzeLotRecallImpact,
  createProductRecallDraft,
  getActiveCampaign,
  getProductRecallCampaign,
  isActiveCampaignUniqueViolation,
};
