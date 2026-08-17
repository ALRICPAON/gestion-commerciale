const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  ACTIVE_CAMPAIGN_UNIQUE_INDEX,
  analyzeLotRecallImpact,
  createProductRecallDraft,
  buildRecallEmailMessage,
  isActiveCampaignUniqueViolation,
  sendProductRecallNotifications,
} = require('../services/productRecallService');

const ROOT = path.resolve(__dirname, '..', '..');
const STORE_A = '60000000-0000-4000-8000-000000000001';
const STORE_B = '60000000-0000-4000-8000-000000000002';
const USER_ID = '60000000-0000-4000-8000-000000000101';
const LOT_A = '60000000-0000-4000-8000-000000000201';
const LOT_EMPTY = '60000000-0000-4000-8000-000000000202';
const LOT_B = '60000000-0000-4000-8000-000000000203';
const LOT_OUTPUT = '60000000-0000-4000-8000-000000000204';
const ARTICLE_A = '60000000-0000-4000-8000-000000000301';
const CLIENT_A = '60000000-0000-4000-8000-000000000401';
const CLIENT_B = '60000000-0000-4000-8000-000000000402';
const CLIENT_C = '60000000-0000-4000-8000-000000000403';
const CLIENT_D = '60000000-0000-4000-8000-000000000404';
const BILLED_CLIENT = '60000000-0000-4000-8000-000000000405';

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeRow(overrides = {}) {
  return {
    store_id: STORE_A,
    lot_id: LOT_A,
    article_id: ARTICLE_A,
    article_plu: 'ART-01',
    article_label: 'Bar entier',
    article_unit: 'kg',
    family_name: 'Poisson',
    lot_code: 'LOT-RAPPEL',
    supplier_lot_number: 'SUP-42',
    qty_initial: 50,
    qty_remaining: 8,
    quality_status: 'available',
    quality_block_reason: null,
    quality_block_reason_type: null,
    quality_block_comment: null,
    quality_blocked_at: null,
    quality_non_conformity_id: null,
    ...overrides,
  };
}

class FakeRecallDb {
  constructor() {
    this.lots = [
      makeRow(),
      makeRow({ lot_id: LOT_EMPTY, lot_code: 'LOT-VIDE', qty_remaining: 11 }),
      makeRow({ store_id: STORE_B, lot_id: LOT_B, lot_code: 'LOT-B', qty_remaining: 4 }),
    ];
    this.clients = [
      { id: CLIENT_A, store_id: STORE_A, name: 'Client livre A', code: 'A', store_identifier: 'A-01', email: 'client-a@example.test', billed_client_id: BILLED_CLIENT },
      { id: CLIENT_B, store_id: STORE_A, name: 'Client livre B', code: 'B', store_identifier: 'B-01', email: null },
      { id: CLIENT_C, store_id: STORE_A, name: 'Client livre C', code: 'C', store_identifier: 'C-01', email: 'client-c@example.test' },
      { id: CLIENT_D, store_id: STORE_A, name: 'Client livre D', code: 'D', store_identifier: 'D-01', email: null },
      { id: BILLED_CLIENT, store_id: STORE_A, name: 'Centrale facturee', code: 'FAC', store_identifier: 'FAC-01', email: 'facture@example.test' },
    ];
    this.contacts = [
      { id: '60000000-0000-4000-8000-000000000501', store_id: STORE_A, client_id: CLIENT_A, contact_name: 'Contact BL A', email: 'bl-a@example.test', status: 'active', receives_delivery_notes: true, is_primary: false },
      { id: '60000000-0000-4000-8000-000000000502', store_id: STORE_A, client_id: CLIENT_B, contact_name: 'Contact principal B', email: 'primary-b@example.test', status: 'active', receives_delivery_notes: false, is_primary: true },
    ];
    this.deliveryRows = [
      this.deliveryRow('DN-1', CLIENT_A, BILLED_CLIENT, 4),
      this.deliveryRow('DN-2', CLIENT_A, BILLED_CLIENT, 5),
      this.deliveryRow('DN-3', CLIENT_B, null, 9),
      this.deliveryRow('DN-4', CLIENT_C, null, 3),
      this.deliveryRow('DN-5', CLIENT_D, null, 2),
    ];
    this.deliveryRowsByLot = {
      [LOT_A]: this.deliveryRows,
      [LOT_OUTPUT]: [this.deliveryRow('DN-PACK', CLIENT_C, null, 6)],
    };
    this.packingLinks = [];
    this.campaigns = [];
    this.recipients = [];
    this.events = [];
    this.evidence = [];
    this.history = [];
    this.nextId = 1;
    this.snapshots = [];
    this.failOnRecipientInsert = false;
    this.failCampaignInsertConstraint = null;
    this.failSentPersistenceForRecipientId = null;
  }

  async connect() {
    return this;
  }

  release() {}

  deliveryRow(reference, clientId, billedClientId, quantity) {
    const delivered = this.clients.find((client) => client.id === clientId);
    const billed = this.clients.find((client) => client.id === billedClientId);
    return {
      delivery_note_id: `60000000-0000-4000-8000-000000000${600 + this.nextDeliveryIndex(reference)}`,
      delivery_note_reference: reference,
      delivery_note_date: '2026-08-16',
      document_type: 'DELIVERY_NOTE',
      delivered_client_id: clientId,
      delivered_client_name: delivered.name,
      delivered_client_code: delivered.code,
      delivered_client_store_identifier: delivered.store_identifier,
      billed_client_id: billed ? billed.id : null,
      billed_client_name: billed ? billed.name : null,
      billed_client_code: billed ? billed.code : null,
      delivered_quantity: quantity,
      allocated_at: '2026-08-16T06:00:00.000Z',
    };
  }

  nextDeliveryIndex(reference) {
    return Number(reference.replace('DN-', ''));
  }

  begin() {
    this.snapshots.push({
      lots: clone(this.lots),
      campaigns: clone(this.campaigns),
      recipients: clone(this.recipients),
      events: clone(this.events),
      evidence: clone(this.evidence),
      history: clone(this.history),
    });
  }

  rollback() {
    const snapshot = this.snapshots.pop();
    if (!snapshot) return;
    Object.assign(this, snapshot);
  }

  commit() {
    this.snapshots.pop();
  }

  async query(sql, params = []) {
    const normalized = String(sql).replace(/\s+/g, ' ').trim();

    if (normalized === 'BEGIN') return this.begin() || { rows: [] };
    if (normalized === 'ROLLBACK') return this.rollback() || { rows: [] };
    if (normalized === 'COMMIT') return this.commit() || { rows: [] };
    if (normalized === 'SELECT gen_random_uuid() AS id') return { rows: [{ id: this.uuid('campaign') }] };

    if (normalized.startsWith('SELECT l.id AS lot_id')) {
      const row = this.lots.find((lot) => lot.store_id === params[0] && lot.lot_id === params[1]);
      return { rows: row ? [clone(row)] : [] };
    }

    if (normalized.startsWith('SELECT sd.id AS delivery_note_id')) {
      const lotId = params[1];
      return { rows: clone(this.deliveryRowsByLot[lotId] || []) };
    }

    if (normalized.startsWith('SELECT po.id AS packing_operation_id') && normalized.includes('FROM packing_source_lots psl')) {
      return { rows: clone(this.packingLinks.filter((link) => link.store_id === params[0] && link.source_lot_id === params[1])) };
    }

    if (normalized.includes('FROM client_contacts') && normalized.includes('receives_delivery_notes = true')) {
      return { rows: this.contactRows(params[0], params[1], (contact) => contact.receives_delivery_notes) };
    }

    if (normalized.includes('FROM client_contacts') && normalized.includes('is_primary = true')) {
      return { rows: this.contactRows(params[0], params[1], (contact) => contact.is_primary) };
    }

    if (normalized.startsWith('SELECT id, name AS contact_name, email FROM clients')) {
      const client = this.clients.find((row) => row.store_id === params[0] && row.id === params[1] && row.email);
      return { rows: client ? [{ id: client.id, contact_name: client.name, email: client.email }] : [] };
    }

    if (normalized.startsWith('SELECT id, status FROM product_recall_campaigns')) {
      const active = this.campaigns.find((campaign) => (
        campaign.store_id === params[0]
        && campaign.lot_id === params[1]
        && params[2].includes(campaign.status)
      ));
      return { rows: active ? [clone(active)] : [] };
    }

    if (normalized.startsWith('SELECT * FROM product_recall_campaigns WHERE store_id')) {
      const row = this.campaigns.find((campaign) => campaign.store_id === params[0] && campaign.id === params[1]);
      return { rows: row ? [clone(row)] : [] };
    }

    if (normalized.startsWith('SELECT c.*, l.lot_code')) {
      const campaign = this.campaigns.find((row) => row.store_id === params[0] && row.id === params[1]);
      if (!campaign) return { rows: [] };
      const lot = this.lots.find((row) => row.store_id === campaign.store_id && row.lot_id === campaign.lot_id);
      return {
        rows: [{
          ...clone(campaign),
          lot_code: lot.lot_code,
          supplier_lot_number: lot.supplier_lot_number,
          qty_initial: lot.qty_initial,
          qty_remaining: lot.qty_remaining,
          quality_status: lot.quality_status,
          quality_block_reason: lot.quality_block_reason,
          quality_block_reason_type: lot.quality_block_reason_type,
          quality_block_comment: lot.quality_block_comment,
          quality_blocked_at: lot.quality_blocked_at,
          article_plu: lot.article_plu,
          article_label: lot.article_label,
          article_unit: lot.article_unit,
          family_name: lot.family_name,
          initiated_by_email: 'responsable@example.test',
        }],
      };
    }

    if (normalized.startsWith('SELECT * FROM product_recall_recipients WHERE store_id')) {
      return {
        rows: clone(this.recipients.filter((recipient) => recipient.store_id === params[0] && recipient.campaign_id === params[1])),
      };
    }

    if (normalized.startsWith('SELECT id, store_id, lot_code, quality_status')) {
      const row = this.lots.find((lot) => lot.lot_id === params[0] && lot.store_id === params[1]);
      return { rows: row ? [{ id: row.lot_id, store_id: row.store_id, lot_code: row.lot_code, quality_status: row.quality_status }] : [] };
    }

    if (normalized.startsWith('UPDATE lots') && normalized.includes("SET quality_status = 'blocked'")) {
      const row = this.lots.find((lot) => lot.lot_id === params[0] && lot.store_id === params[1]);
      if (!row) return { rows: [] };
      Object.assign(row, {
        quality_status: 'blocked',
        quality_block_reason: params[2],
        quality_block_reason_type: params[3],
        quality_block_comment: params[4],
      });
      return { rows: [{ id: row.lot_id, store_id: row.store_id, lot_code: row.lot_code, quality_status: row.quality_status }] };
    }

    if (normalized.startsWith('INSERT INTO quality_lot_status_history')) {
      const row = { id: this.uuid('history'), store_id: params[0], lot_id: params[1], previous_status: params[2], new_status: params[3], source_type: params[7], source_id: params[8] };
      this.history.push(row);
      return { rows: [clone(row)] };
    }

    if (normalized.startsWith('INSERT INTO product_recall_campaigns')) {
      if (this.failCampaignInsertConstraint) {
        const error = new Error('duplicate key value violates unique constraint');
        error.code = '23505';
        error.constraint = this.failCampaignInsertConstraint;
        throw error;
      }
      const row = {
        id: params[0],
        store_id: params[1],
        lot_id: params[2],
        article_id: params[3],
        status: 'draft',
        recall_type: params[4],
        reason: params[5],
        comment: params[6],
        initiated_by: params[7],
        initiated_at: '2026-08-16T07:00:00.000Z',
        prepared_at: '2026-08-16T07:00:00.000Z',
      };
      this.campaigns.push(row);
      return { rows: [clone(row)] };
    }

    if (normalized.startsWith('INSERT INTO product_recall_recipients')) {
      if (this.failOnRecipientInsert) throw new Error('recipient insert failed');
      const row = {
        id: this.uuid('recipient'),
        store_id: params[0],
        campaign_id: params[1],
        delivered_client_id: params[2],
        delivered_client_name: params[3],
        delivered_client_code: params[4],
        delivered_client_store_identifier: params[5],
        email: params[6],
        contact_id: params[7],
        contact_name: params[8],
        contact_source: params[9],
        status: params[10],
        delivered_quantity: params[11],
        delivery_note_count: params[12],
        delivery_notes: JSON.parse(params[13]),
        prepared_subject: null,
        prepared_body: null,
        email_message_id: null,
        sent_at: null,
        error_message: null,
      };
      this.recipients.push(row);
      return { rows: [clone(row)] };
    }

    if (normalized.startsWith("UPDATE product_recall_recipients SET status = 'pending'")) {
      const ids = params[2];
      const sendableStatuses = params[4];
      const rows = this.recipients.filter((recipient) => (
        recipient.store_id === params[0]
        && recipient.campaign_id === params[1]
        && ids.includes(recipient.id)
        && sendableStatuses.includes(recipient.status)
        && recipient.email
      ));
      rows.forEach((recipient) => {
        recipient.status = 'pending';
        recipient.error_message = null;
      });
      return { rows: clone(rows) };
    }

    if (normalized.startsWith("UPDATE product_recall_campaigns SET status = 'sending'")) {
      const row = this.campaigns.find((campaign) => campaign.store_id === params[0] && campaign.id === params[1]);
      if (row) row.status = 'sending';
      return { rows: [] };
    }

    if (normalized.startsWith('UPDATE product_recall_recipients SET status = $4::text')) {
      if (params[3] === 'sent' && this.failSentPersistenceForRecipientId === params[2]) {
        throw new Error('sent persistence failed');
      }
      const row = this.recipients.find((recipient) => (
        recipient.store_id === params[0]
        && recipient.campaign_id === params[1]
        && recipient.id === params[2]
      ));
      if (!row) return { rows: [] };
      row.status = params[3];
      row.prepared_subject = params[4];
      row.prepared_body = params[5];
      row.email_message_id = params[6];
      if (params[3] === 'sent') row.sent_at = '2026-08-16T08:00:00.000Z';
      row.error_message = params[7];
      return { rows: [clone(row)] };
    }

    if (normalized.startsWith('UPDATE product_recall_campaigns SET status = $3::text')) {
      const row = this.campaigns.find((campaign) => campaign.store_id === params[0] && campaign.id === params[1]);
      if (!row) return { rows: [] };
      row.status = params[2];
      if (['sent', 'partial'].includes(row.status) && !row.sent_at) row.sent_at = '2026-08-16T08:01:00.000Z';
      return { rows: [clone(row)] };
    }

    if (normalized.startsWith('INSERT INTO quality_events')) {
      const row = {
        id: this.uuid('event'),
        store_id: params[0],
        event_type: params[1],
        source_table: params[2],
        source_id: params[3],
        occurred_at: params[6],
        triggered_by: params[7],
        event_status: params[8],
        payload: params[10],
      };
      this.events.push(row);
      return { rows: [clone(row)] };
    }

    if (normalized.startsWith('SELECT * FROM quality_events') && normalized.includes('WHERE id = $1::uuid')) {
      const row = this.events.find((event) => event.id === params[0] && event.store_id === params[1]);
      return { rows: row ? [clone(row)] : [] };
    }

    if (normalized.startsWith('SELECT * FROM quality_events')) {
      const row = this.events.find((event) => event.store_id === params[0] && event.id === params[3]);
      return { rows: row ? [clone(row)] : [] };
    }

    if (normalized.startsWith('INSERT INTO quality_evidence_records')) {
      const row = {
        id: this.uuid('evidence'),
        store_id: params[0],
        quality_event_id: params[1],
        evidence_type: params[2],
        evidence_status: params[4],
        evidence_at: params[5],
        source_type: params[7],
        source_record_type: params[8],
        source_record_id: params[9],
        payload: params[18],
      };
      this.evidence.push(row);
      return { rows: [clone(row)] };
    }

    if (normalized.startsWith('UPDATE product_recall_campaigns SET quality_event_id')) {
      const row = this.campaigns.find((campaign) => campaign.store_id === params[0] && campaign.id === params[1]);
      row.quality_event_id = params[2];
      row.quality_evidence_record_id = params[3];
      return { rows: [clone(row)] };
    }

    throw new Error(`Unhandled fake SQL: ${normalized}`);
  }

  contactRows(storeId, clientId, predicate) {
    return this.contacts
      .filter((contact) => contact.store_id === storeId && contact.client_id === clientId && contact.status === 'active' && contact.email && predicate(contact))
      .sort((left, right) => String(left.contact_name).localeCompare(String(right.contact_name)))
      .slice(0, 1)
      .map((contact) => ({ id: contact.id, contact_name: contact.contact_name, email: contact.email }));
  }

  uuid(prefix) {
    const value = this.nextId;
    this.nextId += 1;
    const suffix = String(value).padStart(12, '0');
    return `70000000-0000-4000-8000-${suffix}`;
  }
}

async function testAnalysis() {
  const db = new FakeRecallDb();
  const analysis = await analyzeLotRecallImpact({ db, storeId: STORE_A, lotId: LOT_A });

  assert.strictEqual(analysis.lot.lot_code, 'LOT-RAPPEL');
  assert.strictEqual(analysis.article.designation, 'Bar entier');
  assert.strictEqual(analysis.stock_remaining, 8);
  assert.strictEqual(analysis.clients_count, 4);
  assert.strictEqual(analysis.delivery_notes_count, 5);
  assert.strictEqual(analysis.total_delivered_quantity, 23);

  const clientA = analysis.recipients.find((recipient) => recipient.delivered_client_id === CLIENT_A);
  assert.strictEqual(clientA.delivered_quantity, 9);
  assert.strictEqual(clientA.delivery_note_count, 2);
  assert.strictEqual(clientA.email, 'bl-a@example.test');
  assert.strictEqual(clientA.contact_source, 'delivery_note_contact');
  assert.strictEqual(clientA.delivery_notes[0].billed_client_id, BILLED_CLIENT);

  const clientB = analysis.recipients.find((recipient) => recipient.delivered_client_id === CLIENT_B);
  assert.strictEqual(clientB.email, 'primary-b@example.test');
  assert.strictEqual(clientB.contact_source, 'primary_contact');

  const clientC = analysis.recipients.find((recipient) => recipient.delivered_client_id === CLIENT_C);
  assert.strictEqual(clientC.email, 'client-c@example.test');
  assert.strictEqual(clientC.contact_source, 'client_email');

  const clientD = analysis.recipients.find((recipient) => recipient.delivered_client_id === CLIENT_D);
  assert.strictEqual(clientD.status, 'contact_required');

  const empty = await analyzeLotRecallImpact({ db, storeId: STORE_A, lotId: LOT_EMPTY });
  assert.strictEqual(empty.clients_count, 0);
  assert.deepStrictEqual(empty.recipients, []);

  db.packingLinks.push({
    store_id: STORE_A,
    source_lot_id: LOT_EMPTY,
    packing_operation_id: '60000000-0000-4000-8000-000000000701',
    output_lot_id: LOT_OUTPUT,
    output_lot_code: 'PKG-OUTPUT',
    quantity_used: 6,
    validated_at: '2026-08-16T09:00:00.000Z',
  });
  const packed = await analyzeLotRecallImpact({ db, storeId: STORE_A, lotId: LOT_EMPTY });
  assert.strictEqual(packed.clients_count, 1);
  assert.strictEqual(packed.delivery_notes_count, 1);
  assert.strictEqual(packed.total_delivered_quantity, 6);
  assert.strictEqual(packed.packing_links[0].output_lot_id, LOT_OUTPUT);
  assert.strictEqual(packed.recipients[0].delivery_notes[0].via_packing_operation_id, '60000000-0000-4000-8000-000000000701');
  assert.strictEqual(packed.recipients[0].delivery_notes[0].via_output_lot_code, 'PKG-OUTPUT');

  await assert.rejects(
    () => analyzeLotRecallImpact({ db, storeId: STORE_A, lotId: LOT_B }),
    (error) => error.status === 404 && error.code === 'LOT_NOT_FOUND'
  );
}

async function testDraftTransactionAndEvidence() {
  const db = new FakeRecallDb();
  await db.query('BEGIN');
  const draft = await createProductRecallDraft({
    db,
    storeId: STORE_A,
    lotId: LOT_A,
    userId: USER_ID,
    recallType: 'supplier_recall',
    reason: 'Alerte fournisseur lot SUP-42',
    comment: 'Preparation de campagne uniquement',
  });
  await db.query('COMMIT');

  assert.strictEqual(draft.campaign.status, 'draft');
  assert.strictEqual(draft.recipients.length, 4);
  assert.strictEqual(draft.lot_block.source_type, 'product_recall');
  assert.strictEqual(draft.lot_block.overwrite_existing_block, false);
  assert.strictEqual(db.lots.find((lot) => lot.lot_id === LOT_A).quality_status, 'blocked');
  assert.strictEqual(db.history[0].source_type, 'product_recall');
  assert.strictEqual(db.campaigns[0].quality_event_id, db.events[0].id);
  assert.strictEqual(db.campaigns[0].quality_evidence_record_id, db.evidence[0].id);
  assert.strictEqual(db.events[0].event_type, 'product_recall_initiated');
  assert.strictEqual(db.evidence[0].evidence_type, 'product_recall_record');
  assert.strictEqual(db.evidence[0].payload.impact.clients_count, 4);
  assert.strictEqual(db.evidence[0].payload.recipients.find((recipient) => recipient.delivered_client_id === CLIENT_D).status, 'contact_required');

  await assert.rejects(
    () => createProductRecallDraft({
      db,
      storeId: STORE_A,
      lotId: LOT_A,
      userId: USER_ID,
      recallType: 'supplier_recall',
      reason: 'Doublon interdit',
    }),
    (error) => error.status === 409 && error.code === 'PRODUCT_RECALL_ACTIVE_EXISTS'
  );
}

async function testConcurrentActiveCampaignConflict() {
  const db = new FakeRecallDb();
  db.failCampaignInsertConstraint = ACTIVE_CAMPAIGN_UNIQUE_INDEX;

  await assert.rejects(
    () => createProductRecallDraft({
      db,
      storeId: STORE_A,
      lotId: LOT_A,
      userId: USER_ID,
      recallType: 'supplier_recall',
      reason: 'Conflit concurrent',
    }),
    (error) => (
      error.status === 409
      && error.code === 'PRODUCT_RECALL_ACTIVE_EXISTS'
      && error.needsActiveCampaignLookup === true
    )
  );

  db.failCampaignInsertConstraint = 'some_other_unique_constraint';
  await assert.rejects(
    () => createProductRecallDraft({
      db,
      storeId: STORE_A,
      lotId: LOT_A,
      userId: USER_ID,
      recallType: 'supplier_recall',
      reason: 'Autre contrainte',
    }),
    (error) => error.code === '23505' && error.constraint === 'some_other_unique_constraint' && !error.status
  );

  assert.strictEqual(isActiveCampaignUniqueViolation({ code: '23505', constraint: ACTIVE_CAMPAIGN_UNIQUE_INDEX }), true);
  assert.strictEqual(isActiveCampaignUniqueViolation({ code: '23505', constraint: 'other' }), false);
}

async function testAlreadyBlockedDoesNotOverwrite() {
  const db = new FakeRecallDb();
  const lot = db.lots.find((row) => row.lot_id === LOT_EMPTY);
  Object.assign(lot, {
    quality_status: 'blocked',
    quality_block_reason: 'Blocage manuel existant',
    quality_block_reason_type: 'quality_suspicion',
  });

  const draft = await createProductRecallDraft({
    db,
    storeId: STORE_A,
    lotId: LOT_EMPTY,
    userId: USER_ID,
    recallType: 'health_alert',
    reason: 'Alerte sanitaire',
  });

  assert.strictEqual(draft.lot_block.already_blocked, true);
  assert.strictEqual(lot.quality_block_reason, 'Blocage manuel existant');
  assert.strictEqual(db.history.length, 0);
}

async function testRollback() {
  const db = new FakeRecallDb();
  db.failOnRecipientInsert = true;
  await db.query('BEGIN');
  await assert.rejects(
    () => createProductRecallDraft({
      db,
      storeId: STORE_A,
      lotId: LOT_A,
      userId: USER_ID,
      recallType: 'quality_suspicion',
      reason: 'Suspicion qualite',
    }),
    /recipient insert failed/
  );
  await db.query('ROLLBACK');

  assert.strictEqual(db.campaigns.length, 0);
  assert.strictEqual(db.recipients.length, 0);
  assert.strictEqual(db.events.length, 0);
  assert.strictEqual(db.evidence.length, 0);
  assert.strictEqual(db.history.length, 0);
  assert.strictEqual(db.lots.find((lot) => lot.lot_id === LOT_A).quality_status, 'available');
}

async function createDraftForSend(db) {
  const draft = await createProductRecallDraft({
    db,
    storeId: STORE_A,
    lotId: LOT_A,
    userId: USER_ID,
    recallType: 'supplier_recall',
    reason: 'Alerte fournisseur lot SUP-42',
    comment: 'Commentaire client',
  });
  return draft;
}

async function testRecallEmailMessage() {
  const db = new FakeRecallDb();
  const draft = await createDraftForSend(db);
  const source = await require('../services/productRecallService').getProductRecallCampaign({
    db,
    storeId: STORE_A,
    campaignId: draft.campaign.id,
  });
  const recipient = source.recipients.find((row) => row.delivered_client_id === CLIENT_A);
  const message = buildRecallEmailMessage(source, recipient);

  assert.strictEqual(message.subject, 'Rappel produit - Bar entier - Lot LOT-RAPPEL');
  assert(message.text.includes('Bonjour Contact BL A,'));
  assert(message.text.includes('Motif :\nAlerte fournisseur lot SUP-42'));
  assert(message.text.includes('Informations complementaires :\nCommentaire client'));
  assert(message.text.includes('DN-1'));
  assert(message.text.includes('DN-2'));
  assert(!message.text.includes('DN-3'));

  source.campaign.comment = null;
  assert(!buildRecallEmailMessage(source, recipient).text.includes('Informations complementaires'));
}

async function testSendRecallNotifications() {
  const db = new FakeRecallDb();
  const draft = await createDraftForSend(db);
  const readyRecipients = draft.recipients.filter((recipient) => recipient.status === 'ready');
  const contactRequired = draft.recipients.find((recipient) => recipient.status === 'contact_required');
  const sent = [];

  const result = await sendProductRecallNotifications({
    db,
    storeId: STORE_A,
    campaignId: draft.campaign.id,
    recipientIds: readyRecipients.map((recipient) => recipient.id).concat(contactRequired.id),
    userId: USER_ID,
    sendEmailFn: async (message) => {
      sent.push(message);
      if (message.to === 'primary-b@example.test') throw new Error('SMTP refuse');
      return { message_id: `smtp-${sent.length}` };
    },
  });

  assert.strictEqual(sent.length, 3);
  assert.strictEqual(result.summary.sent, 2);
  assert.strictEqual(result.summary.failed, 1);
  assert.strictEqual(result.summary.contact_required, 1);
  assert.strictEqual(result.summary.pending, 0);
  assert.strictEqual(result.campaign.status, 'partial');
  assert.strictEqual(db.recipients.find((recipient) => recipient.id === contactRequired.id).status, 'contact_required');
  assert(db.recipients.find((recipient) => recipient.email === 'bl-a@example.test').email_message_id);
  assert(db.recipients.find((recipient) => recipient.email === 'primary-b@example.test').error_message.includes('SMTP refuse'));
  assert.strictEqual(db.events.some((event) => event.event_type === 'product_recall_notifications_processed'), true);
  assert.strictEqual(db.evidence.some((record) => record.evidence_type === 'product_recall_notification_record'), true);

  const retryTarget = db.recipients.find((recipient) => recipient.email === 'primary-b@example.test');
  const retry = await sendProductRecallNotifications({
    db,
    storeId: STORE_A,
    campaignId: draft.campaign.id,
    recipientIds: db.recipients.map((recipient) => recipient.id),
    userId: USER_ID,
    sendEmailFn: async (message) => ({ message_id: `retry-${message.to}` }),
  });
  assert.strictEqual(retry.results.length, 1);
  assert.strictEqual(retry.results[0].id, retryTarget.id);
  assert.strictEqual(db.recipients.filter((recipient) => recipient.status === 'sent').length, 3);
}

async function testSmtpSuccessDbPersistenceFailureStaysPending() {
  const db = new FakeRecallDb();
  const draft = await createDraftForSend(db);
  const target = draft.recipients.find((recipient) => recipient.email === 'bl-a@example.test');
  let sendCount = 0;
  db.failSentPersistenceForRecipientId = target.id;
  const originalConsoleError = console.error;
  console.error = () => {};

  let result;
  try {
    result = await sendProductRecallNotifications({
      db,
      storeId: STORE_A,
      campaignId: draft.campaign.id,
      recipientIds: [target.id],
      userId: USER_ID,
      sendEmailFn: async () => {
        sendCount += 1;
        return { message_id: 'smtp-123' };
      },
    });
  } finally {
    console.error = originalConsoleError;
  }

  const stored = db.recipients.find((recipient) => recipient.id === target.id);
  assert.strictEqual(sendCount, 1);
  assert.strictEqual(stored.status, 'pending');
  assert.strictEqual(stored.error_message, null);
  assert.strictEqual(result.results[0].status, 'pending');
  assert.strictEqual(result.results[0].email_message_id, 'smtp-123');
  assert.strictEqual(result.results[0].error_code, 'SMTP_SUCCESS_DB_PERSISTENCE_FAILED');
  assert.strictEqual(result.summary.pending, 1);
  assert.strictEqual(result.summary.failed, 0);
  assert.strictEqual(result.campaign.status, 'sending');
  assert.strictEqual(db.evidence.at(-1).payload.summary.pending, 1);
  assert.strictEqual(db.evidence.at(-1).payload.summary.sent, 0);

  db.failSentPersistenceForRecipientId = null;
  await assert.rejects(
    () => sendProductRecallNotifications({
      db,
      storeId: STORE_A,
      campaignId: draft.campaign.id,
      recipientIds: [target.id],
      userId: USER_ID,
      sendEmailFn: async () => {
        sendCount += 1;
        return { message_id: 'smtp-should-not-send' };
      },
    }),
    (error) => error.status === 409 && error.code === 'PRODUCT_RECALL_NOT_SENDABLE'
  );
  assert.strictEqual(sendCount, 1);
  assert.strictEqual(stored.status, 'pending');
}

async function testDoubleClickGuard() {
  const db = new FakeRecallDb();
  const draft = await createDraftForSend(db);
  const selected = draft.recipients.filter((recipient) => recipient.status === 'ready').map((recipient) => recipient.id);
  const client = await db.connect();

  await client.query('BEGIN');
  const first = await client.query(
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
    [STORE_A, draft.campaign.id, selected, USER_ID, ['ready', 'failed']]
  );
  await client.query('COMMIT');
  const second = await client.query(
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
    [STORE_A, draft.campaign.id, selected, USER_ID, ['ready', 'failed']]
  );

  assert.strictEqual(first.rows.length, 3);
  assert.strictEqual(second.rows.length, 0);
}

function testStaticGuards() {
  const migration = read('backend/db/gestion-commerciale/104_product_recall_foundation.sql');
  assert(migration.includes('CREATE TABLE IF NOT EXISTS product_recall_campaigns'));
  assert(migration.includes('CREATE TABLE IF NOT EXISTS product_recall_recipients'));
  assert(migration.includes("WHERE status NOT IN ('closed', 'cancelled')"));
  assert(migration.includes('FOREIGN KEY (lot_id, store_id)'));
  assert(migration.includes('FOREIGN KEY (delivered_client_id, store_id)'));
  assert(read('backend/db/gestion-commerciale/104_product_recall_foundation_rollback.sql').includes('DROP TABLE IF EXISTS product_recall_campaigns'));

  const route = read('backend/routes/traceability.js');
  assert(route.includes("router.get('/lots/:lotId/recall-analysis'"));
  assert(route.includes("router.post('/lots/:lotId/recall'"));
  assert(route.includes("router.post('/recalls/:campaignId/send'"));
  assert(route.includes('createProductRecallDraft'));
  assert(route.includes('sendProductRecallNotifications'));

  const service = read('backend/services/productRecallService.js');
  assert(service.includes("eventType: 'product_recall_initiated'"));
  assert(service.includes("evidenceType: 'product_recall_record'"));
  assert(service.includes("eventType: 'product_recall_notifications_processed'"));
  assert(service.includes("evidenceType: 'product_recall_notification_record'"));
  assert(service.includes('SMTP_SUCCESS_DB_PERSISTENCE_FAILED'));
  assert(service.includes("sourceType: 'product_recall'"));
  assert(service.includes("error.code === '23505'"));
  assert(service.includes("error.constraint === ACTIVE_CAMPAIGN_UNIQUE_INDEX"));
  assert(service.includes("const { sendEmail } = require('./emailService')"));
  assert(!route.includes('sendEmail'));
}

async function main() {
  await testAnalysis();
  await testDraftTransactionAndEvidence();
  await testConcurrentActiveCampaignConflict();
  await testAlreadyBlockedDoesNotOverwrite();
  await testRollback();
  await testRecallEmailMessage();
  await testSendRecallNotifications();
  await testSmtpSuccessDbPersistenceFailureStaysPending();
  await testDoubleClickGuard();
  testStaticGuards();
  console.log(JSON.stringify({
    ok: true,
    tests: [
      'analysis_aggregates_delivered_clients',
      'contact_resolution_delivery_note_primary_client_email_missing',
      'empty_lot',
      'multi_store_404',
      'draft_transaction_block_campaign_recipients_event_evidence',
      'active_campaign_idempotence',
      'concurrent_active_campaign_unique_23505',
      'already_blocked_no_overwrite',
      'rollback',
      'backend_email_subject_body_client_delivery_notes',
      'send_success_failure_contact_required_retry_evidence',
      'smtp_success_db_persistence_failed_stays_pending',
      'double_click_pending_reservation_guard',
      'static_guards_email_send_endpoint_only',
    ],
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
