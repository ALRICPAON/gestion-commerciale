const evidenceRecords = require('../quality/evidenceRecords');
const lotBlocking = require('../quality/lotBlocking');
const traceabilityTests = require('../quality/traceabilityTestService');
const productRecall = require('../productRecallService');

function clean(value) {
  return String(value || '').trim();
}

function limit(value, fallback = 50, max = 100) {
  const parsed = Number(value);
  return Math.min(Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback, max);
}

function textFilter(input, ...names) {
  for (const name of names) {
    const value = clean(input[name]);
    if (value) return value;
  }
  return null;
}

function evidenceFilters(input = {}) {
  return {
    evidence_type: textFilter(input, 'evidence_type', 'type'),
    evidence_status: textFilter(input, 'evidence_status', 'status', 'statut'),
    date_from: textFilter(input, 'date_from', 'from'),
    date_to: textFilter(input, 'date_to', 'to'),
    search: textFilter(input, 'search', 'query'),
    limit: limit(input.limit, 50, 100),
  };
}

async function listQualityEvidenceRecords(db, storeId, input = {}) {
  return evidenceRecords.listQualityEvidenceRecords(db, storeId, evidenceFilters(input));
}

async function getQualityEvidenceRecord(db, storeId, input = {}) {
  const id = clean(input.evidence_id || input.id);
  if (!id) {
    const error = new Error('ID enregistrement qualite requis');
    error.status = 400;
    throw error;
  }
  return evidenceRecords.getQualityEvidenceRecord(db, storeId, id);
}

async function listQualityEvents(db, storeId, input = {}) {
  const params = [storeId];
  const where = ['qe.store_id = $1::uuid'];
  const eventType = textFilter(input, 'event_type', 'type');
  const sourceTable = clean(input.source_table);
  const sourceId = clean(input.source_id);
  const dateFrom = textFilter(input, 'date_from', 'date');
  const dateTo = clean(input.date_to);

  if (eventType) {
    params.push(eventType);
    where.push(`qe.event_type = $${params.length}`);
  }
  if (sourceTable) {
    params.push(sourceTable);
    where.push(`qe.source_table = $${params.length}`);
  }
  if (sourceId) {
    params.push(sourceId);
    where.push(`qe.source_id = $${params.length}::uuid`);
  }
  if (dateFrom) {
    params.push(dateFrom);
    where.push(`qe.occurred_at >= $${params.length}::date`);
  }
  if (dateTo) {
    params.push(dateTo);
    where.push(`qe.occurred_at < ($${params.length}::date + INTERVAL '1 day')`);
  }

  params.push(limit(input.limit, 50, 100));
  const result = await db.query(
    `SELECT qe.*
     FROM quality_events qe
     WHERE ${where.join(' AND ')}
     ORDER BY qe.occurred_at DESC NULLS LAST, qe.created_at DESC
     LIMIT $${params.length}::integer`,
    params
  );
  return result.rows;
}

async function getQualityEvent(db, storeId, input = {}) {
  const id = clean(input.event_id || input.id);
  if (!id) {
    const error = new Error('ID evenement qualite requis');
    error.status = 400;
    throw error;
  }
  const result = await db.query(
    'SELECT * FROM quality_events WHERE id = $1::uuid AND store_id = $2::uuid LIMIT 1',
    [id, storeId]
  );
  return result.rows[0] || null;
}

async function listQualityBlockedLots(db, storeId, input = {}) {
  const params = [storeId];
  const where = ["l.store_id = $1::uuid", "COALESCE(l.quality_status, 'available') = 'blocked'"];
  const search = textFilter(input, 'search', 'query');
  if (search) {
    params.push(`%${search}%`);
    where.push(`(
      l.lot_code ILIKE $${params.length}
      OR COALESCE(l.supplier_lot_number, '') ILIKE $${params.length}
      OR COALESCE(a.plu, '') ILIKE $${params.length}
      OR COALESCE(a.designation, '') ILIKE $${params.length}
    )`);
  }
  params.push(limit(input.limit, 50, 100));
  const result = await db.query(
    `SELECT
       l.id AS lot_id,
       l.lot_code,
       l.supplier_lot_number,
       l.qty_remaining,
       COALESCE(l.quality_status, 'available') AS quality_status,
       l.quality_block_reason,
       l.quality_block_reason_type,
       l.quality_block_comment,
       l.quality_blocked_at,
       l.quality_non_conformity_id,
       a.id AS article_id,
       a.plu AS article_plu,
       a.designation AS article_label
     FROM lots l
     LEFT JOIN articles a ON a.id = l.article_id AND a.store_id = l.store_id
     WHERE ${where.join(' AND ')}
     ORDER BY l.quality_blocked_at DESC NULLS LAST, l.updated_at DESC NULLS LAST, l.created_at DESC
     LIMIT $${params.length}::integer`,
    params
  );
  return result.rows;
}

async function getLotQualityStatus(db, storeId, input = {}) {
  const lotId = clean(input.lot_id || input.id);
  if (!lotId) {
    const error = new Error('ID lot requis');
    error.status = 400;
    throw error;
  }
  const [status, history] = await Promise.all([
    lotBlocking.getLotQualityStatus(db, storeId, lotId),
    db.query(
      `SELECT *
       FROM quality_lot_status_history
       WHERE store_id = $1::uuid AND lot_id = $2::uuid
       ORDER BY changed_at DESC NULLS LAST`,
      [storeId, lotId]
    ).then((result) => result.rows),
  ]);
  return { status, history };
}

async function searchTraceabilityLots(db, storeId, input = {}) {
  return traceabilityTests.searchTraceabilityTestLots({
    db,
    storeId,
    search: textFilter(input, 'search', 'query'),
    limit: limit(input.limit, 50, 50),
  });
}

async function getTraceabilitySnapshot(db, storeId, input = {}) {
  const lotId = clean(input.lot_id || input.id);
  if (!lotId) {
    const error = new Error('ID lot requis');
    error.status = 400;
    throw error;
  }
  return traceabilityTests.buildTraceabilityTestSnapshot({ db, storeId, lotId });
}

async function listTraceabilityTests(db, storeId, input = {}) {
  const records = await listQualityEvidenceRecords(db, storeId, {
    ...input,
    evidence_type: 'traceability_test_record',
    limit: limit(input.limit, 50, 100),
  });
  const result = clean(input.result);
  const lot = clean(input.lot || input.lot_code || input.lot_id);
  const article = clean(input.article || input.article_plu || input.article_label);
  return records.filter((record) => {
    const payload = record.payload || {};
    if (result && payload.result !== result) return false;
    if (lot) {
      const lotText = `${payload.lot?.lot_id || ''} ${payload.lot?.lot_code || ''} ${payload.lot?.supplier_lot_number || ''}`.toLowerCase();
      if (!lotText.includes(lot.toLowerCase())) return false;
    }
    if (article) {
      const articleText = `${payload.article?.article_id || ''} ${payload.article?.plu || ''} ${payload.article?.designation || ''}`.toLowerCase();
      if (!articleText.includes(article.toLowerCase())) return false;
    }
    return true;
  });
}

async function getTraceabilityTest(db, storeId, input = {}) {
  return getQualityEvidenceRecord(db, storeId, {
    id: input.evidence_id || input.id,
  });
}

async function listProductRecallCampaigns(db, storeId, input = {}) {
  const params = [storeId];
  const where = ['c.store_id = $1::uuid'];
  const status = clean(input.status);
  const lot = clean(input.lot || input.lot_id || input.lot_code);
  const article = clean(input.article || input.article_id || input.article_plu);
  const client = clean(input.client || input.client_id || input.client_name);
  const dateFrom = clean(input.date_from || input.date);
  const dateTo = clean(input.date_to);

  if (status) {
    params.push(status);
    where.push(`c.status = $${params.length}`);
  }
  if (lot) {
    params.push(`%${lot}%`);
    where.push(`(c.lot_id::text ILIKE $${params.length} OR l.lot_code ILIKE $${params.length} OR COALESCE(l.supplier_lot_number, '') ILIKE $${params.length})`);
  }
  if (article) {
    params.push(`%${article}%`);
    where.push(`(c.article_id::text ILIKE $${params.length} OR COALESCE(a.plu, '') ILIKE $${params.length} OR COALESCE(a.designation, '') ILIKE $${params.length})`);
  }
  if (client) {
    params.push(`%${client}%`);
    where.push(`EXISTS (
      SELECT 1 FROM product_recall_recipients r
      WHERE r.store_id = c.store_id AND r.campaign_id = c.id
        AND (r.delivered_client_id::text ILIKE $${params.length} OR COALESCE(r.delivered_client_name, '') ILIKE $${params.length})
    )`);
  }
  if (dateFrom) {
    params.push(dateFrom);
    where.push(`c.initiated_at >= $${params.length}::date`);
  }
  if (dateTo) {
    params.push(dateTo);
    where.push(`c.initiated_at < ($${params.length}::date + INTERVAL '1 day')`);
  }

  params.push(limit(input.limit, 50, 100));
  const result = await db.query(
    `SELECT
       c.id, c.lot_id, c.article_id, c.status, c.recall_type, c.reason, c.comment,
       c.initiated_at, c.prepared_at, c.sent_at, c.closed_at,
       l.lot_code, l.supplier_lot_number, l.qty_remaining,
       a.plu AS article_plu, a.designation AS article_label,
       COUNT(r.id)::integer AS recipient_count,
       COUNT(*) FILTER (WHERE r.status = 'ready')::integer AS ready_count,
       COUNT(*) FILTER (WHERE r.status = 'contact_required')::integer AS contact_required_count,
       COUNT(*) FILTER (WHERE r.status = 'failed')::integer AS failed_count,
       COUNT(*) FILTER (WHERE r.status = 'pending')::integer AS pending_count,
       COUNT(*) FILTER (WHERE r.status = 'sent')::integer AS sent_count
     FROM product_recall_campaigns c
     JOIN lots l ON l.id = c.lot_id AND l.store_id = c.store_id
     LEFT JOIN articles a ON a.id = c.article_id AND a.store_id = c.store_id
     LEFT JOIN product_recall_recipients r ON r.store_id = c.store_id AND r.campaign_id = c.id
     WHERE ${where.join(' AND ')}
     GROUP BY c.id, l.lot_code, l.supplier_lot_number, l.qty_remaining, a.plu, a.designation
     ORDER BY c.initiated_at DESC NULLS LAST, c.created_at DESC
     LIMIT $${params.length}::integer`,
    params
  );
  return result.rows;
}

async function getProductRecallCampaign(db, storeId, input = {}) {
  return productRecall.getProductRecallCampaign({
    db,
    storeId,
    campaignId: input.campaign_id || input.id,
  });
}

async function analyzeProductRecallForLot(db, storeId, input = {}) {
  return productRecall.analyzeLotRecallImpact({
    db,
    storeId,
    lotId: input.lot_id || input.id,
  });
}

async function prepareRecallNotifications(db, storeId, input = {}) {
  const campaign = await getProductRecallCampaign(db, storeId, input);
  const selectedIds = Array.isArray(input.recipient_ids) ? input.recipient_ids.map(clean).filter(Boolean) : [];
  const recipients = campaign.recipients.filter((recipient) => selectedIds.length === 0 || selectedIds.includes(recipient.id));
  const sendableStatuses = new Set(['ready', 'failed']);
  return {
    campaign: campaign.campaign,
    lot: campaign.lot,
    article: campaign.article,
    recipients: recipients.map((recipient) => {
      const message = productRecall.buildRecallEmailMessage(campaign, recipient);
      return {
        recipient_id: recipient.id,
        client: {
          delivered_client_id: recipient.delivered_client_id,
          delivered_client_name: recipient.delivered_client_name,
          delivered_client_code: recipient.delivered_client_code,
          delivered_client_store_identifier: recipient.delivered_client_store_identifier,
        },
        contact_name: recipient.contact_name || null,
        email: recipient.email || null,
        subject: message.subject,
        body: message.text,
        body_preview: message.text ? message.text.slice(0, 800) : null,
        delivery_notes: recipient.delivery_notes || [],
        delivered_quantity: recipient.delivered_quantity,
        status: recipient.status,
        sendable: sendableStatuses.has(recipient.status),
      };
    }),
    message_count: recipients.length,
    sendable_count: recipients.filter((recipient) => sendableStatuses.has(recipient.status)).length,
  };
}

module.exports = {
  analyzeProductRecallForLot,
  getLotQualityStatus,
  getProductRecallCampaign,
  getQualityEvent,
  getQualityEvidenceRecord,
  getTraceabilitySnapshot,
  getTraceabilityTest,
  listProductRecallCampaigns,
  listQualityBlockedLots,
  listQualityEvents,
  listQualityEvidenceRecords,
  listTraceabilityTests,
  prepareRecallNotifications,
  searchTraceabilityLots,
};
