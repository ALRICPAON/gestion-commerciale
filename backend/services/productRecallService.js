const {
  ALREADY_BLOCKED_CODE,
  STATUS_BLOCKED,
  blockLotForQuality,
} = require('./quality/lotBlocking');
const {
  createOrGetQualityEvent,
  createOrGetQualityEvidenceRecord,
} = require('./quality/events');
const { sendEmail } = require('./emailService');

const ACTIVE_CAMPAIGN_STATUSES = ['draft', 'ready', 'sending', 'sent', 'partial'];
const ACTIVE_CAMPAIGN_UNIQUE_INDEX = 'uq_product_recall_active_lot';
const SENDABLE_CAMPAIGN_STATUSES = ['draft', 'ready', 'partial'];
const SENDABLE_RECIPIENT_STATUSES = ['ready', 'failed'];
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

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[char]));
}

function formatRecallDate(value) {
  const text = clean(value);
  if (!text) return '-';
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : text;
}

function buildRecallEmailSubject(source = {}) {
  const article = source.article || {};
  const lot = source.lot || {};
  return `Rappel produit - ${article.designation || article.plu || 'Produit'} - Lot ${lot.lot_code || '-'}`;
}

function recallGreeting(recipient = {}) {
  const name = clean(recipient.contact_name) || clean(recipient.delivered_client_name);
  return name ? `Bonjour ${name},` : 'Bonjour,';
}

function buildRecallEmailText(source = {}, recipient = {}) {
  const article = source.article || {};
  const lot = source.lot || {};
  const campaign = source.campaign || {};
  const notes = Array.isArray(recipient.delivery_notes) ? recipient.delivery_notes : [];
  const deliveryLines = notes.length
    ? notes.map((note) => `- ${note.reference || note.delivery_note_reference || note.delivery_note_id || '-'} - ${formatRecallDate(note.date || note.delivery_note_date)} - ${toNumber(note.delivered_quantity)}`)
    : ['- Aucun BL detaille'];
  const supplierLot = clean(lot.supplier_lot_number) ? `Lot fournisseur : ${lot.supplier_lot_number}\n` : '';
  const comment = clean(campaign.comment);
  const commentBlock = comment ? `\nInformations complementaires :\n${comment}\n` : '';

  return `${recallGreeting(recipient)}

Dans le cadre de notre procedure de retrait/rappel produit, nous vous informons qu'un rappel concerne le produit suivant :

Produit : ${article.designation || article.plu || '-'}
Lot : ${lot.lot_code || '-'}
${supplierLot}
Livraisons concernees :
${deliveryLines.join('\n')}

Quantite totale livree : ${toNumber(recipient.delivered_quantity)}

Motif :
${campaign.reason || '-'}
${commentBlock}
Merci d'isoler immediatement le produit restant et de ne plus le commercialiser.

Merci de nous confirmer la quantite encore presente dans votre etablissement.

Cordialement,

ALTA MAREE`;
}

function buildRecallEmailHtml(source = {}, recipient = {}) {
  return buildRecallEmailText(source, recipient)
    .split('\n')
    .map((line) => (line ? `<p>${escapeHtml(line)}</p>` : '<br>'))
    .join('');
}

function buildRecallEmailMessage(source = {}, recipient = {}) {
  const subject = buildRecallEmailSubject(source);
  const text = buildRecallEmailText(source, recipient);
  return {
    to: clean(recipient.email),
    subject,
    text,
    html: buildRecallEmailHtml(source, recipient),
  };
}

function buildNotificationEvidencePayload({ campaign, lot, article, recipients, sentAt }) {
  const rows = Array.isArray(recipients) ? recipients : [];
  return {
    campaign: {
      id: campaign.id,
      status: campaign.status,
      recall_type: campaign.recall_type,
      reason: campaign.reason,
      comment: campaign.comment || null,
      sent_at: sentAt,
    },
    lot,
    article,
    summary: {
      sent: rows.filter((recipient) => recipient.status === 'sent').length,
      failed: rows.filter((recipient) => recipient.status === 'failed').length,
      contact_required: rows.filter((recipient) => recipient.status === 'contact_required').length,
      pending: rows.filter((recipient) => recipient.status === 'pending').length,
      skipped: rows.filter((recipient) => recipient.status === 'skipped').length,
    },
    recipients: rows.map((recipient) => ({
      id: recipient.id,
      delivered_client_id: recipient.delivered_client_id,
      delivered_client_name: recipient.delivered_client_name,
      email: recipient.email || null,
      contact_name: recipient.contact_name || null,
      status: recipient.status,
      sent_at: recipient.sent_at || null,
      message_id: recipient.email_message_id || null,
      error_message: recipient.error_message || null,
      delivered_quantity: toNumber(recipient.delivered_quantity),
      delivery_note_count: Number(recipient.delivery_note_count || 0),
      delivery_notes: Array.isArray(recipient.delivery_notes) ? recipient.delivery_notes : [],
    })),
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
      email_message_id: recipient.email_message_id || null,
      sent_at: recipient.sent_at || null,
      error_message: recipient.error_message || null,
    })),
  };
}

async function reserveRecallRecipientsForSend(client, { storeId, campaignId, recipientIds, userId }) {
  const selectedIds = (Array.isArray(recipientIds) ? recipientIds : []).map(clean).filter(isUuid);
  if (!selectedIds.length) throw makeError('Aucun destinataire selectionne pour l envoi', 400, 'NO_RECALL_RECIPIENT_SELECTED');

  const campaignResult = await client.query(
    `SELECT *
     FROM product_recall_campaigns
     WHERE store_id = $1::uuid
       AND id = $2::uuid
     FOR UPDATE`,
    [storeId, campaignId]
  );
  const campaign = campaignResult.rows[0];
  if (!campaign) throw makeError('Rappel produit introuvable pour ce magasin', 404, 'PRODUCT_RECALL_NOT_FOUND');
  if (!SENDABLE_CAMPAIGN_STATUSES.includes(campaign.status)) {
    throw makeError('Campagne de rappel non envoyable dans son statut actuel', 409, 'PRODUCT_RECALL_NOT_SENDABLE');
  }

  const recipientsResult = await client.query(
    `UPDATE product_recall_recipients
     SET status = 'pending',
         error_message = NULL,
         updated_at = now(),
         updated_by = $4::uuid
     WHERE store_id = $1::uuid
       AND campaign_id = $2::uuid
       AND id = ANY($3::uuid[])
       AND status = ANY($5::text[])
       AND NULLIF(btrim(email), '') IS NOT NULL
     RETURNING *`,
    [storeId, campaignId, selectedIds, userId, SENDABLE_RECIPIENT_STATUSES]
  );
  if (!recipientsResult.rows.length) {
    throw makeError('Aucun destinataire selectionne n est envoyable', 409, 'NO_SENDABLE_RECALL_RECIPIENT');
  }

  await client.query(
    `UPDATE product_recall_campaigns
     SET status = 'sending',
         updated_at = now(),
         updated_by = $3::uuid
     WHERE store_id = $1::uuid
       AND id = $2::uuid`,
    [storeId, campaignId, userId]
  );

  return recipientsResult.rows;
}

async function recordRecallRecipientSendResult(db, { storeId, campaignId, recipientId, status, subject, body, messageId, errorMessage, userId }) {
  const result = await db.query(
    `UPDATE product_recall_recipients
     SET status = $4::text,
         prepared_subject = $5::text,
         prepared_body = $6::text,
         email_message_id = $7::text,
         sent_at = CASE WHEN $4::text = 'sent' THEN now() ELSE sent_at END,
         error_message = $8::text,
         updated_at = now(),
         updated_by = $9::uuid
     WHERE store_id = $1::uuid
       AND campaign_id = $2::uuid
       AND id = $3::uuid
     RETURNING *`,
    [storeId, campaignId, recipientId, status, subject, body, messageId || null, errorMessage || null, userId]
  );
  return result.rows[0] || null;
}

function resolveCampaignStatus(recipients = []) {
  const activeRecipients = recipients.filter((recipient) => recipient.status !== 'skipped');
  const hasContactRequired = activeRecipients.some((recipient) => recipient.status === 'contact_required');
  const hasFailed = activeRecipients.some((recipient) => recipient.status === 'failed');
  const hasPending = activeRecipients.some((recipient) => recipient.status === 'pending');
  const emailRecipients = activeRecipients.filter((recipient) => clean(recipient.email));
  const allEmailsSent = emailRecipients.length > 0 && emailRecipients.every((recipient) => recipient.status === 'sent');

  if (hasPending) return 'sending';
  if (allEmailsSent && !hasContactRequired && !hasFailed) return 'sent';
  if (activeRecipients.some((recipient) => recipient.status === 'sent') || hasFailed || hasContactRequired) return 'partial';
  return 'ready';
}

async function finalizeRecallCampaignAfterSend(db, { storeId, campaignId, userId }) {
  const recipientsResult = await db.query(
    `SELECT *
     FROM product_recall_recipients
     WHERE store_id = $1::uuid
       AND campaign_id = $2::uuid
     ORDER BY delivered_client_name ASC NULLS LAST, id ASC`,
    [storeId, campaignId]
  );
  const recipients = recipientsResult.rows;
  const status = resolveCampaignStatus(recipients);
  const campaignResult = await db.query(
    `UPDATE product_recall_campaigns
     SET status = $3::text,
         sent_at = CASE WHEN $3::text IN ('sent', 'partial') AND sent_at IS NULL THEN now() ELSE sent_at END,
         updated_at = now(),
         updated_by = $4::uuid
     WHERE store_id = $1::uuid
       AND id = $2::uuid
     RETURNING *`,
    [storeId, campaignId, status, userId]
  );
  return { campaign: campaignResult.rows[0], recipients };
}

async function createRecallNotificationEvidence(db, { storeId, campaignId, userId, sentAt }) {
  const source = await getProductRecallCampaign({ db, storeId, campaignId });
  const occurredAt = sentAt || new Date();
  const payload = buildNotificationEvidencePayload({
    campaign: source.campaign,
    lot: source.lot,
    article: source.article,
    recipients: source.recipients,
    sentAt: toIso(occurredAt),
  });
  const discriminator = `notifications-${Date.now()}`;
  const eventResult = await createOrGetQualityEvent({
    db,
    storeId,
    eventType: 'product_recall_notifications_processed',
    sourceTable: 'product_recall_campaigns',
    sourceId: campaignId,
    sourceDiscriminator: discriminator,
    occurredAt,
    triggeredBy: userId,
    eventStatus: 'recorded',
    payloadVersion: 1,
    payload,
    userId,
  });
  const evidenceResult = await createOrGetQualityEvidenceRecord({
    db,
    storeId,
    qualityEventId: eventResult.event.id,
    evidenceType: 'product_recall_notification_record',
    evidenceStatus: 'recorded',
    evidenceAt: occurredAt,
    recordedBy: userId,
    sourceType: 'automatic',
    sourceRecordType: 'product_recall_campaigns',
    sourceRecordId: campaignId,
    sourceDiscriminator: discriminator,
    payloadVersion: 1,
    payload,
    userId,
  });
  return { quality_event: eventResult.event, quality_evidence_record: evidenceResult.evidence };
}

async function sendProductRecallNotifications({
  db,
  storeId,
  campaignId,
  recipientIds,
  userId,
  sendEmailFn = sendEmail,
} = {}) {
  if (!db || typeof db.connect !== 'function') throw makeError('Pool base invalide', 500, 'INVALID_DB_POOL');
  if (!isUuid(storeId)) throw makeError('Magasin invalide', 400, 'INVALID_STORE');
  if (!isUuid(campaignId)) throw makeError('ID campagne invalide', 400, 'INVALID_RECALL_CAMPAIGN');
  if (!isUuid(userId)) throw makeError('Utilisateur invalide', 400, 'INVALID_USER');

  const client = await db.connect();
  let reservedRecipients;
  try {
    await client.query('BEGIN');
    reservedRecipients = await reserveRecallRecipientsForSend(client, {
      storeId,
      campaignId,
      recipientIds,
      userId,
    });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const campaignSource = await getProductRecallCampaign({ db, storeId, campaignId });
  const results = [];
  for (const recipient of reservedRecipients) {
    const message = buildRecallEmailMessage(campaignSource, recipient);
    let delivery;
    try {
      delivery = await sendEmailFn({
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
    } catch (error) {
      const recorded = await recordRecallRecipientSendResult(db, {
        storeId,
        campaignId,
        recipientId: recipient.id,
        status: 'failed',
        subject: message.subject,
        body: message.text,
        messageId: null,
        errorMessage: clean(error.message) || 'Erreur envoi email',
        userId,
      });
      results.push({ ...recorded, status: 'failed' });
      continue;
    }

    try {
      const recorded = await recordRecallRecipientSendResult(db, {
        storeId,
        campaignId,
        recipientId: recipient.id,
        status: 'sent',
        subject: message.subject,
        body: message.text,
        messageId: delivery && delivery.message_id,
        errorMessage: null,
        userId,
      });
      results.push({ ...recorded, status: 'sent' });
    } catch (error) {
      console.error('SMTP_SUCCESS_DB_PERSISTENCE_FAILED', {
        recipientId: recipient.id,
        campaignId,
        storeId,
        message_id: delivery && delivery.message_id,
        error: error.message,
      });
      results.push({
        ...recipient,
        status: 'pending',
        email_message_id: delivery && delivery.message_id,
        persistence_error: clean(error.message) || 'Erreur persistance apres succes SMTP',
        error_code: 'SMTP_SUCCESS_DB_PERSISTENCE_FAILED',
      });
    }
  }

  const finalized = await finalizeRecallCampaignAfterSend(db, { storeId, campaignId, userId });
  const quality = await createRecallNotificationEvidence(db, {
    storeId,
    campaignId,
    userId,
    sentAt: finalized.campaign?.sent_at || new Date(),
  });

  const recipients = finalized.recipients;
  const summary = {
    sent: recipients.filter((recipient) => recipient.status === 'sent').length,
    failed: recipients.filter((recipient) => recipient.status === 'failed').length,
    contact_required: recipients.filter((recipient) => recipient.status === 'contact_required').length,
    pending: recipients.filter((recipient) => recipient.status === 'pending').length,
    skipped: recipients.filter((recipient) => recipient.status === 'skipped').length,
  };

  return {
    ok: true,
    campaign: finalized.campaign,
    lot: campaignSource.lot,
    article: campaignSource.article,
    summary,
    results,
    recipients,
    ...quality,
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
  SENDABLE_CAMPAIGN_STATUSES,
  SENDABLE_RECIPIENT_STATUSES,
  analyzeLotRecallImpact,
  buildRecallEmailMessage,
  createProductRecallDraft,
  getActiveCampaign,
  getProductRecallCampaign,
  isActiveCampaignUniqueViolation,
  sendProductRecallNotifications,
};
