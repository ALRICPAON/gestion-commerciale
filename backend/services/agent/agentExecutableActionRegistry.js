const commercial = require('../agentCommercialToolsService');
const qualityDocumentation = require('../quality/qualityDocumentationService');
const qualityVersions = require('../quality/qualityDocumentationVersionService');

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
        version: before.version || null,
      },
      after: {
        content_html: section.content_html || '',
        status: section.status || null,
        version: section.version || null,
      },
      version_before: before.version || null,
      version_after: section.version || null,
      status: section.status || null,
      version_behavior: before.version === section.version
        ? 'Modification de brouillon: le service conserve la version du chapitre tant qu une nouvelle version metier n est pas fournie ou qu une validation/publication ne la modifie pas.'
        : 'Version du chapitre modifiee par le service metier.',
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
    description: 'Applique un paquet de mises a jour de chapitres de documentation qualite via qualityDocumentationService.updateSection.',
    aliases: [
      'apply_quality_documentation_updates',
      'apply_quality_section_updates',
      'quality_section_update',
      'update_quality_section',
      'versioned_update',
    ],
    module: 'quality_documentation',
    requiredPermission: 'quality.documentation.edit',
    requiredPermissions: ['mcp.execute', 'quality.documentation.edit'],
    service: 'qualityDocumentationService.updateSection',
    confirmationLevel: 'explicit_human',
    reversible: true,
    previewRequired: true,
    batch: true,
    payloadSchema: {
      type: 'object',
      required: ['updates'],
      properties: {
        collection_id: { type: 'string', description: 'Collection documentaire attendue, optionnelle.' },
        mode: { type: 'string', enum: ['all_or_nothing'], description: 'Mode transactionnel par defaut.' },
        updates: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['section_id', 'content_html'],
            properties: {
              section_id: { type: 'string' },
              content_html: { type: 'string' },
              status: { type: 'string' },
              comment_internal: { type: 'string' },
              change_summary: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    example: {
      action_type: 'quality.documentation.apply_section_updates',
      summary: 'Appliquer les modifications du Tome 1',
      payload: {
        mode: 'all_or_nothing',
        updates: [
          {
            section_id: 'uuid-section',
            content_html: '<p>Contenu mis a jour</p>',
            change_summary: 'Application du paquet Tome 1',
          },
        ],
      },
    },
    validatePayload: normalizeQualityDocumentationBatch,
    execute: executeQualityDocumentationBatch,
  },
  {
    name: 'sales.create_customer_order',
    description: 'Cree une commande client brouillon confirmee via le service commercial.',
    aliases: ['customer_order_draft', 'create_customer_order'],
    module: 'sales',
    requiredPermission: 'sales.write',
    requiredPermissions: ['mcp.execute', 'sales.write'],
    service: 'agentCommercialToolsService.createCustomerOrderConfirmed',
    confirmationLevel: 'explicit_human',
    reversible: false,
    previewRequired: true,
    batch: false,
    payloadSchema: { type: 'object', additionalProperties: true },
    example: { action_type: 'sales.create_customer_order', summary: 'Creer la commande client', payload: { client_id: 'uuid-client', lines: [] } },
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
    description: 'Convertit une commande client en bon de livraison via le service commercial.',
    aliases: ['customer_delivery_note_draft', 'validate_order_to_bl', 'validate_order_to_delivery_note'],
    module: 'sales',
    requiredPermission: 'sales.write',
    requiredPermissions: ['mcp.execute', 'sales.write'],
    service: 'agentCommercialToolsService.convertOrderToDeliveryNote',
    confirmationLevel: 'explicit_human',
    reversible: false,
    previewRequired: true,
    batch: false,
    payloadSchema: { type: 'object', required: ['reference_number'], properties: { reference_number: { type: 'string' }, sale_id: { type: 'string' } }, additionalProperties: true },
    example: { action_type: 'sales.convert_order_to_delivery_note', summary: 'Valider le BL', payload: { reference_number: 'CMD-0001' } },
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
