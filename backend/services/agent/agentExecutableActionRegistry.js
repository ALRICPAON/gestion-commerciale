const commercial = require('../agentCommercialToolsService');
const qualityDocumentation = require('../quality/qualityDocumentationService');
const qualityVersions = require('../quality/qualityDocumentationVersionService');
const { stripHtml } = require('../quality/qualityDocumentationTemplateService');

function text(value) {
  return String(value || '').trim();
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const error = new Error(`${label} doit etre un objet`);
    error.status = 400;
    error.expose = true;
    throw error;
  }
}

function assertUuidLike(value, label) {
  const normalized = text(value);
  if (!normalized) {
    const error = new Error(`${label} requis`);
    error.status = 400;
    error.expose = true;
    throw error;
  }
  return normalized;
}

function normalizeQualitySectionUpdate(raw = {}) {
  assertObject(raw, 'chapitre');
  return {
    section_id: assertUuidLike(raw.section_id, 'section_id'),
    content_html: String(raw.content_html || ''),
    status: text(raw.status) || undefined,
    comment_internal: text(raw.comment_internal) || undefined,
    change_summary: text(raw.change_summary) || 'Modification appliquee par l agent MCP',
  };
}

function normalizeQualityDocumentationBatch(payload = {}) {
  assertObject(payload, 'payload');
  const updates = Array.isArray(payload.updates) ? payload.updates.map(normalizeQualitySectionUpdate) : [];
  if (updates.length === 0) {
    const error = new Error('updates doit contenir au moins un chapitre a modifier');
    error.status = 400;
    error.expose = true;
    throw error;
  }
  const seen = new Set();
  for (const update of updates) {
    if (seen.has(update.section_id)) {
      const error = new Error(`Chapitre duplique dans le lot : ${update.section_id}`);
      error.status = 400;
      error.expose = true;
      throw error;
    }
    seen.add(update.section_id);
  }
  return {
    collection_id: text(payload.collection_id) || undefined,
    mode: text(payload.mode) || 'all_or_nothing',
    updates,
  };
}

async function getQualitySection(db, storeId, sectionId) {
  const result = await db.query(
    'SELECT * FROM quality_documentation_sections WHERE id = $1 AND store_id = $2 LIMIT 1',
    [sectionId, storeId]
  );
  return result.rows[0] || null;
}

async function executeQualityDocumentationBatch({ db, context, payload, pendingAction }) {
  const normalized = normalizeQualityDocumentationBatch(payload);
  if (normalized.mode !== 'all_or_nothing') {
    const error = new Error('Le mode partiel doit etre explicitement implemente avant execution');
    error.status = 400;
    error.expose = true;
    throw error;
  }

  const modified = [];
  for (const update of normalized.updates) {
    const before = await getQualitySection(db, context.store_id, update.section_id);
    if (!before || before.archived_at) {
      const error = new Error(`Chapitre qualite introuvable ou archive : ${update.section_id}`);
      error.status = 404;
      error.expose = true;
      throw error;
    }
    if (normalized.collection_id && before.collection_id !== normalized.collection_id) {
      const error = new Error(`Chapitre hors collection demandee : ${update.section_id}`);
      error.status = 400;
      error.expose = true;
      throw error;
    }

    const section = await qualityDocumentation.updateSection(
      db,
      context.store_id,
      update.section_id,
      context.user_id,
      {
        ...update,
        content_text: stripHtml(update.content_html || ''),
        change_summary: `${update.change_summary} (${pendingAction.id})`,
      }
    );
    const versions = await qualityVersions.listSectionVersions(db, context.store_id, section.id);
    modified.push({
      section_id: section.id,
      code: section.code,
      title: section.title,
      version_id: versions[0]?.id || null,
      before: {
        content_html: before.content_html || '',
        status: before.status || null,
      },
      after: {
        content_html: section.content_html || '',
        status: section.status || null,
      },
    });
  }

  return {
    ok: true,
    mode: 'executed',
    action: 'quality.documentation.apply_section_updates',
    module: 'quality_documentation',
    target_type: 'quality_documentation_sections',
    target_id: normalized.collection_id || null,
    modified_count: modified.length,
    modified_sections: modified,
  };
}

const ACTIONS = [
  {
    name: 'quality.documentation.apply_section_updates',
    aliases: ['apply_quality_documentation_updates', 'apply_quality_section_updates'],
    module: 'quality_documentation',
    requiredPermission: 'quality.documentation.edit',
    service: 'qualityDocumentationService.updateSection',
    confirmationLevel: 'explicit_human',
    reversible: true,
    previewRequired: true,
    batch: true,
    validatePayload: normalizeQualityDocumentationBatch,
    execute: executeQualityDocumentationBatch,
  },
  {
    name: 'sales.create_customer_order',
    aliases: ['customer_order_draft', 'create_customer_order'],
    module: 'sales',
    requiredPermission: 'sales.write',
    service: 'agentCommercialToolsService.createCustomerOrderConfirmed',
    confirmationLevel: 'explicit_human',
    reversible: false,
    previewRequired: true,
    batch: false,
    validatePayload: (payload) => {
      assertObject(payload, 'payload');
      return payload;
    },
    execute: async ({ dbPool, context, payload }) => ({
      ok: true,
      mode: 'executed',
      action: 'sales.create_customer_order',
      module: 'sales',
      result: await commercial.createCustomerOrderConfirmed(dbPool, context.store_id, payload),
    }),
  },
  {
    name: 'sales.convert_order_to_delivery_note',
    aliases: ['customer_delivery_note_draft', 'validate_order_to_bl', 'validate_order_to_delivery_note'],
    module: 'sales',
    requiredPermission: 'sales.write',
    service: 'agentCommercialToolsService.convertOrderToDeliveryNote',
    confirmationLevel: 'explicit_human',
    reversible: false,
    previewRequired: true,
    batch: false,
    validatePayload: (payload) => {
      assertObject(payload, 'payload');
      return payload;
    },
    execute: async ({ dbPool, context, payload }) => ({
      ok: true,
      mode: 'executed',
      action: 'sales.convert_order_to_delivery_note',
      module: 'sales',
      result: await commercial.convertOrderToDeliveryNote(dbPool, context.store_id, { ...payload, confirmation: 'human_confirmed' }),
    }),
  },
];

const actionByName = new Map();
for (const action of ACTIONS) {
  actionByName.set(action.name, action);
  for (const alias of action.aliases || []) actionByName.set(alias, action);
}

function getExecutableAction(name) {
  return actionByName.get(text(name)) || null;
}

function listExecutableActions() {
  return ACTIONS.map(({ execute, validatePayload, ...action }) => action);
}

module.exports = {
  getExecutableAction,
  listExecutableActions,
};
