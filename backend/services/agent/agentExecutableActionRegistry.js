const commercial = require('../agentCommercialToolsService');
const lotBlocking = require('../quality/lotBlocking');
const qualityBlocks = require('../quality/qualityDocumentBlockService');
const qualityDocumentation = require('../quality/qualityDocumentationService');
const qualityVersions = require('../quality/qualityDocumentationVersionService');
const traceabilityTests = require('../quality/traceabilityTestService');
const productRecall = require('../productRecallService');
const {
  executeArticleStorageConditionsUpdate,
  normalizeArticleStorageUpdatePayload,
} = require('../agentArticleStorageService');
const callSheet = require('../agentCallSheetService');

const callSheetLinePayloadSchema = {
  type: 'object',
  minProperties: 1,
  properties: {
    article_id: { type: ['string', 'null'] },
    designation: { type: ['string', 'null'] },
    designation_snapshot: { type: ['string', 'null'] },
    supplier_id: { type: ['string', 'null'] },
    purchase_price: { type: ['number', 'string', 'null'] },
    purchase_price_ht: { type: ['number', 'string', 'null'] },
    unit: { type: ['string', 'null'] },
    price_unit: { type: ['string', 'null'] },
    sale_unit: { type: ['string', 'null'] },
    supplier_available_quantity: { type: ['number', 'string', 'null'] },
    sale_price_level_1_ht: { type: ['number', 'string', 'null'] },
    sale_price_level_2_ht: { type: ['number', 'string', 'null'] },
    sale_price_level_3_ht: { type: ['number', 'string', 'null'] },
    tariff_1: { type: ['number', 'string', 'null'] },
    tariff_2: { type: ['number', 'string', 'null'] },
    tariff_3: { type: ['number', 'string', 'null'] },
    display_order: { type: 'integer' },
  },
  additionalProperties: false,
};

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

function optionalUuidLike(value, label) {
  return text(value) ? assertUuidLike(value, label) : null;
}

function normalizeLotBlockPayload(payload = {}) {
  assertObject(payload, 'payload');
  return {
    lot_id: assertUuidLike(payload.lot_id || payload.id, 'lot_id'),
    reason_type: text(payload.reason_type) || text(payload.recall_type),
    reason: text(payload.reason),
    comment: text(payload.comment) || null,
    quality_non_conformity_id: optionalUuidLike(payload.quality_non_conformity_id, 'quality_non_conformity_id'),
  };
}

function normalizeLotReleasePayload(payload = {}) {
  assertObject(payload, 'payload');
  return {
    lot_id: assertUuidLike(payload.lot_id || payload.id, 'lot_id'),
    reason: text(payload.reason),
    comment: text(payload.comment),
  };
}

function normalizeTraceabilityTestCompletionPayload(payload = {}) {
  assertObject(payload, 'payload');
  return {
    lot_id: assertUuidLike(payload.lot_id || payload.id, 'lot_id'),
    result: text(payload.result),
    observation: text(payload.observation) || null,
    corrective_action: text(payload.corrective_action || payload.correctiveAction) || null,
    started_at: text(payload.started_at || payload.startedAt) || null,
  };
}

function normalizeProductRecallPayload(payload = {}) {
  assertObject(payload, 'payload');
  return {
    lot_id: assertUuidLike(payload.lot_id || payload.id, 'lot_id'),
    recall_type: text(payload.recall_type || payload.recallType),
    reason: text(payload.reason),
    comment: text(payload.comment) || null,
  };
}

function normalizeRecallNotificationsPayload(payload = {}) {
  assertObject(payload, 'payload');
  const recipientIds = Array.isArray(payload.recipient_ids || payload.recipientIds)
    ? (payload.recipient_ids || payload.recipientIds).map((id) => assertUuidLike(id, 'recipient_id'))
    : [];
  if (!recipientIds.length) {
    const error = new Error('recipient_ids doit contenir au moins un destinataire');
    error.status = 400;
    error.expose = true;
    throw error;
  }
  return {
    campaign_id: assertUuidLike(payload.campaign_id || payload.id, 'campaign_id'),
    recipient_ids: recipientIds,
  };
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

function normalizeBlockIdPayload(payload = {}) {
  assertObject(payload, 'payload');
  return { block_id: assertUuidLike(payload.block_id, 'block_id') };
}

function normalizeMoveBlockPayload(payload = {}) {
  assertObject(payload, 'payload');
  if (!Array.isArray(payload.block_ids) || payload.block_ids.length === 0) {
    const error = new Error('block_ids doit contenir l ordre complet des blocs');
    error.status = 400;
    error.expose = true;
    throw error;
  }
  return {
    chapter_id: assertUuidLike(payload.chapter_id || payload.section_id, 'chapter_id'),
    block_ids: payload.block_ids.map((id) => assertUuidLike(id, 'block_id')),
  };
}

function normalizeTextBlockPayload(payload = {}) {
  assertObject(payload, 'payload');
  const html = String(payload.html || payload.content_html || '');
  if (/<\s*(table|thead|tbody|tr|td|th)\b/i.test(html) || /\bdata-(?:table|diagram)-id\s*=/i.test(html) || /quality-(?:table|diagram)-block/i.test(html)) {
    const error = new Error('Un bloc rich_text ne doit pas contenir de tableau ou diagramme structure. Utiliser add_table_block ou add_diagram_block.');
    error.status = 400;
    error.expose = true;
    throw error;
  }
  return {
    block_id: payload.block_id ? assertUuidLike(payload.block_id, 'block_id') : undefined,
    chapter_id: (payload.chapter_id || payload.section_id) ? assertUuidLike(payload.chapter_id || payload.section_id, 'chapter_id') : undefined,
    html,
    title: text(payload.title) || undefined,
    position: Number.isFinite(Number(payload.position)) ? Number(payload.position) : undefined,
  };
}

function slugId(value, fallback) {
  const normalized = String(value || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function normalizeMcpTableData(input = {}) {
  assertObject(input, 'table_data');
  if (!Array.isArray(input.columns) || input.columns.length === 0) {
    const error = new Error('columns doit contenir au moins une colonne pour add_table_block');
    error.status = 400;
    error.expose = true;
    throw error;
  }
  const columns = input.columns.map((column, index) => {
    if (typeof column === 'string') {
      return { id: slugId(column, `col-${index + 1}`), label: column };
    }
    assertObject(column, `columns[${index}]`);
    return {
      id: slugId(column.id || column.label, `col-${index + 1}`),
      label: text(column.label || column.id || `Colonne ${index + 1}`),
      alignment: text(column.alignment) || undefined,
      width: Number.isFinite(Number(column.width)) ? Number(column.width) : undefined,
    };
  });
  const ids = new Set();
  for (const column of columns) {
    if (ids.has(column.id)) {
      const error = new Error(`Identifiant de colonne duplique : ${column.id}`);
      error.status = 400;
      error.expose = true;
      throw error;
    }
    ids.add(column.id);
  }
  const rows = (Array.isArray(input.rows) ? input.rows : []).map((row, rowIndex) => {
    if (Array.isArray(row)) {
      if (row.length !== columns.length) {
        const error = new Error(`rows[${rowIndex}] doit contenir ${columns.length} cellule(s)`);
        error.status = 400;
        error.expose = true;
        throw error;
      }
      return {
        id: `row-${rowIndex + 1}`,
        cells: Object.fromEntries(columns.map((column, index) => [column.id, row[index]])),
      };
    }
    assertObject(row, `rows[${rowIndex}]`);
    const rawCells = row.cells && typeof row.cells === 'object' && !Array.isArray(row.cells) ? row.cells : row;
    return {
      id: text(row.id) || `row-${rowIndex + 1}`,
      cells: Object.fromEntries(columns.map((column) => [column.id, rawCells[column.id] ?? rawCells[column.label] ?? ''])),
    };
  });
  return {
    title: text(input.title) || undefined,
    header: input.header !== false,
    columns,
    rows,
  };
}

function normalizeCreateBlockPayload(payload = {}, blockType) {
  assertObject(payload, 'payload');
  const content = payload.content && typeof payload.content === 'object' && !Array.isArray(payload.content)
    ? { ...payload.content }
    : {};
  if (blockType === 'document_table') {
    const tableSource = content.table_data && typeof content.table_data === 'object' && !Array.isArray(content.table_data)
      ? content.table_data
      : payload;
    const hasTablePayload = Array.isArray(tableSource.columns) || Array.isArray(tableSource.rows);
    if (hasTablePayload) {
      content.table_data = normalizeMcpTableData({
        title: tableSource.title || payload.title,
        header: tableSource.header,
        columns: tableSource.columns,
        rows: tableSource.rows,
      });
      delete content.table_template_key;
    }
  }
  return {
    chapter_id: assertUuidLike(payload.chapter_id || payload.section_id, 'chapter_id'),
    block_type: blockType,
    title: text(payload.title) || undefined,
    position: Number.isFinite(Number(payload.position)) ? Number(payload.position) : undefined,
    content: Object.keys(content).length ? content : payload,
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
    name: 'call_sheet.add_line',
    description: 'Ajoute une ligne produit a une fiche appel existante, sans calcul automatique de tarifs.',
    aliases: ['quick_order_sheet.add_line'],
    module: 'call_sheet',
    requiredPermission: 'call_sheet.write',
    requiredPermissions: ['mcp.execute', 'call_sheet.write'],
    service: 'agentCallSheetService.executeAddLine',
    confirmationLevel: 'explicit_human',
    reversible: true,
    previewRequired: true,
    batch: false,
    payloadSchema: {
      type: 'object',
      required: ['sheet_id', 'line'],
      properties: {
        sheet_id: { type: 'string' },
        line: callSheetLinePayloadSchema,
      },
      additionalProperties: false,
    },
    example: { action_type: 'call_sheet.add_line', payload: { sheet_id: 'uuid-fiche', line: { article_id: 'uuid-article', purchase_price: 18.5, supplier_id: 'uuid-fournisseur' } } },
    validatePayload: callSheet.normalizeAddLinePayload,
    execute: callSheet.executeAddLine,
  },
  {
    name: 'call_sheet.update_line',
    description: 'Modifie partiellement une ligne de fiche appel. Les tarifs 1/2/3 ne changent que si les champs sont presents.',
    aliases: ['quick_order_sheet.update_line'],
    module: 'call_sheet',
    requiredPermission: 'call_sheet.write',
    requiredPermissions: ['mcp.execute', 'call_sheet.write'],
    service: 'agentCallSheetService.executeUpdateLine',
    confirmationLevel: 'explicit_human',
    reversible: true,
    previewRequired: true,
    batch: false,
    payloadSchema: {
      type: 'object',
      required: ['line_id', 'changes'],
      properties: {
        line_id: { type: 'string' },
        changes: callSheetLinePayloadSchema,
      },
      additionalProperties: false,
    },
    example: { action_type: 'call_sheet.update_line', payload: { line_id: 'uuid-ligne', changes: { purchase_price: 19.2 } } },
    validatePayload: callSheet.normalizeUpdateLinePayload,
    execute: callSheet.executeUpdateLine,
  },
  {
    name: 'call_sheet.delete_line',
    description: 'Supprime physiquement une ligne de fiche appel, apres confirmation humaine explicite.',
    aliases: ['quick_order_sheet.delete_line'],
    module: 'call_sheet',
    requiredPermission: 'call_sheet.write',
    requiredPermissions: ['mcp.execute', 'call_sheet.write'],
    service: 'agentCallSheetService.executeDeleteLine',
    confirmationLevel: 'explicit_human',
    reversible: false,
    previewRequired: true,
    batch: false,
    payloadSchema: {
      type: 'object',
      required: ['line_id'],
      properties: { line_id: { type: 'string' } },
      additionalProperties: false,
    },
    example: { action_type: 'call_sheet.delete_line', payload: { line_id: 'uuid-ligne' } },
    validatePayload: callSheet.normalizeDeleteLinePayload,
    execute: callSheet.executeDeleteLine,
  },
  {
    name: 'articles.update_storage_conditions',
    description: 'Met a jour uniquement les conditions de conservation d un Article apres confirmation humaine. Aucun autre champ Article, stock, lot, allocation, vente ou facture n est modifie.',
    aliases: ['article.update_storage_conditions', 'update_article_storage_conditions'],
    module: 'articles',
    requiredPermission: 'articles.write',
    requiredPermissions: ['mcp.execute', 'articles.write'],
    service: 'articleStorageConditions.mergeStoragePatch',
    confirmationLevel: 'explicit_human',
    reversible: true,
    previewRequired: true,
    batch: false,
    payloadSchema: {
      type: 'object',
      required: ['article_id', 'changes'],
      properties: {
        article_id: { type: 'string' },
        changes: {
          type: 'object',
          minProperties: 1,
          properties: {
            storage_temperature_min: { type: ['number', 'string', 'null'] },
            storage_temperature_max: { type: ['number', 'string', 'null'] },
            storage_instruction: { type: ['string', 'null'] },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    example: {
      action_type: 'articles.update_storage_conditions',
      payload: {
        article_id: 'uuid-article',
        changes: {
          storage_temperature_min: 3,
          storage_temperature_max: 5,
          storage_instruction: 'Ce produit doit etre vendu vivant',
        },
      },
    },
    validatePayload: normalizeArticleStorageUpdatePayload,
    execute: executeArticleStorageConditionsUpdate,
  },
  {
    name: 'quality.documentation.apply_section_updates',
    description: 'Applique un paquet de mises a jour de chapitres de documentation qualite via qualityDocumentationService.updateSection.',
    aliases: [],
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
    name: 'quality.documentation.update_text_block',
    description: 'Met a jour uniquement un bloc rich_text existant via qualityDocumentBlockService.updateDocumentBlock. Ne jamais utiliser pour ajouter un nouveau paragraphe, tableau ou diagramme: utiliser add_text_block, add_table_block ou add_diagram_block.',
    aliases: [],
    module: 'quality_documentation',
    requiredPermission: 'quality.documentation.edit',
    requiredPermissions: ['mcp.execute', 'quality.documentation.edit'],
    service: 'qualityDocumentBlockService.updateDocumentBlock',
    confirmationLevel: 'explicit_human',
    reversible: true,
    previewRequired: false,
    batch: false,
    payloadSchema: { type: 'object', required: ['block_id', 'html'], properties: { block_id: { type: 'string' }, html: { type: 'string' }, title: { type: 'string' } }, additionalProperties: false },
    example: { action_type: 'quality.documentation.update_text_block', payload: { block_id: 'uuid-block', html: '<p>Texte</p>' } },
    validatePayload: (payload) => {
      const normalized = normalizeTextBlockPayload(payload);
      if (!normalized.block_id) {
        const error = new Error('block_id requis');
        error.status = 400;
        error.expose = true;
        throw error;
      }
      return normalized;
    },
    execute: async ({ db, context, payload }) => ({
      ok: true,
      mode: 'executed',
      action: 'quality.documentation.update_text_block',
      module: 'quality_documentation',
      block: await qualityBlocks.updateDocumentBlock(db, context.store_id, payload.block_id, context.user_id, { title: payload.title, content: { html: payload.html } }),
    }),
  },
  {
    name: 'quality.documentation.add_text_block',
    description: 'Cree une nouvelle ligne quality_document_blocks de type rich_text via qualityDocumentBlockService.createChapterBlock, avec nouvel UUID. Ne modifie pas le bloc rich_text existant.',
    aliases: [],
    module: 'quality_documentation',
    requiredPermission: 'quality.documentation.edit',
    requiredPermissions: ['mcp.execute', 'quality.documentation.edit'],
    service: 'qualityDocumentBlockService.createChapterBlock',
    confirmationLevel: 'explicit_human',
    reversible: true,
    previewRequired: false,
    batch: false,
    payloadSchema: { type: 'object', required: ['html'], properties: { chapter_id: { type: 'string' }, section_id: { type: 'string' }, html: { type: 'string' }, title: { type: 'string' }, position: { type: 'number' } }, additionalProperties: false },
    example: { action_type: 'quality.documentation.add_text_block', payload: { section_id: 'uuid-section', html: '<p>Nouveau texte</p>' } },
    validatePayload: (payload) => {
      const normalized = normalizeTextBlockPayload(payload);
      if (!normalized.chapter_id) {
        const error = new Error('chapter_id requis');
        error.status = 400;
        error.expose = true;
        throw error;
      }
      return normalized;
    },
    execute: async ({ db, context, payload }) => ({
      ok: true,
      mode: 'executed',
      action: 'quality.documentation.add_text_block',
      module: 'quality_documentation',
      block: await qualityBlocks.createChapterBlock(db, context.store_id, payload.chapter_id, context.user_id, { block_type: 'rich_text', title: payload.title, position: payload.position, content: { html: payload.html } }),
    }),
  },
  {
    name: 'quality.documentation.add_table_block',
    description: 'Cree une nouvelle ligne quality_document_blocks de type document_table via qualityDocumentBlockService.createChapterBlock, avec nouvel UUID et structure table_data. N injecte jamais de tableau HTML dans un rich_text.',
    aliases: [],
    module: 'quality_documentation',
    requiredPermission: 'quality.documentation.edit',
    requiredPermissions: ['mcp.execute', 'quality.documentation.edit'],
    service: 'qualityDocumentBlockService.createChapterBlock',
    confirmationLevel: 'explicit_human',
    reversible: true,
    previewRequired: false,
    batch: false,
    payloadSchema: { type: 'object', properties: { chapter_id: { type: 'string' }, section_id: { type: 'string' }, title: { type: 'string' }, content: { type: 'object' } }, additionalProperties: true },
    example: { action_type: 'quality.documentation.add_table_block', payload: { section_id: 'uuid-section', columns: ['Champ', 'Valeur'], rows: [['Test', 'OK']] } },
    validatePayload: (payload) => normalizeCreateBlockPayload(payload, 'document_table'),
    execute: async ({ db, context, payload }) => ({ ok: true, mode: 'executed', action: 'quality.documentation.add_table_block', module: 'quality_documentation', block: await qualityBlocks.createChapterBlock(db, context.store_id, payload.chapter_id, context.user_id, payload) }),
  },
  {
    name: 'quality.documentation.add_diagram_block',
    description: 'Cree une nouvelle ligne quality_document_blocks de type mermaid_diagram via qualityDocumentBlockService.createChapterBlock, avec nouvel UUID. N injecte jamais de diagramme HTML dans un rich_text.',
    aliases: [],
    module: 'quality_documentation',
    requiredPermission: 'quality.documentation.edit',
    requiredPermissions: ['mcp.execute', 'quality.documentation.edit'],
    service: 'qualityDocumentBlockService.createChapterBlock',
    confirmationLevel: 'explicit_human',
    reversible: true,
    previewRequired: false,
    batch: false,
    payloadSchema: { type: 'object', properties: { chapter_id: { type: 'string' }, section_id: { type: 'string' }, title: { type: 'string' }, content: { type: 'object' } }, additionalProperties: true },
    example: { action_type: 'quality.documentation.add_diagram_block', payload: { section_id: 'uuid-section', content: { diagram_template_key: 'default' } } },
    validatePayload: (payload) => normalizeCreateBlockPayload(payload, 'mermaid_diagram'),
    execute: async ({ db, context, payload }) => ({ ok: true, mode: 'executed', action: 'quality.documentation.add_diagram_block', module: 'quality_documentation', block: await qualityBlocks.createChapterBlock(db, context.store_id, payload.chapter_id, context.user_id, payload) }),
  },
  {
    name: 'quality.documentation.delete_block',
    description: 'Supprime un bloc documentaire via qualityDocumentBlockService.deleteDocumentBlock.',
    aliases: [],
    module: 'quality_documentation',
    requiredPermission: 'quality.documentation.edit',
    requiredPermissions: ['mcp.execute', 'quality.documentation.edit'],
    service: 'qualityDocumentBlockService.deleteDocumentBlock',
    confirmationLevel: 'explicit_human',
    reversible: false,
    previewRequired: false,
    batch: false,
    payloadSchema: { type: 'object', required: ['block_id'], properties: { block_id: { type: 'string' } }, additionalProperties: false },
    example: { action_type: 'quality.documentation.delete_block', payload: { block_id: 'uuid-block' } },
    validatePayload: normalizeBlockIdPayload,
    execute: async ({ db, context, payload }) => ({ ok: true, mode: 'executed', action: 'quality.documentation.delete_block', module: 'quality_documentation', block: await qualityBlocks.deleteDocumentBlock(db, context.store_id, payload.block_id, context.user_id) }),
  },
  {
    name: 'quality.documentation.move_block',
    description: 'Reordonne les blocs d un chapitre via qualityDocumentBlockService.reorderChapterBlocks.',
    aliases: [],
    module: 'quality_documentation',
    requiredPermission: 'quality.documentation.edit',
    requiredPermissions: ['mcp.execute', 'quality.documentation.edit'],
    service: 'qualityDocumentBlockService.reorderChapterBlocks',
    confirmationLevel: 'explicit_human',
    reversible: true,
    previewRequired: false,
    batch: false,
    payloadSchema: { type: 'object', required: ['block_ids'], properties: { chapter_id: { type: 'string' }, section_id: { type: 'string' }, block_ids: { type: 'array', items: { type: 'string' } } }, additionalProperties: false },
    example: { action_type: 'quality.documentation.move_block', payload: { section_id: 'uuid-section', block_ids: ['uuid-block-1', 'uuid-block-2'] } },
    validatePayload: normalizeMoveBlockPayload,
    execute: async ({ db, context, payload }) => ({ ok: true, mode: 'executed', action: 'quality.documentation.move_block', module: 'quality_documentation', blocks: await qualityBlocks.reorderChapterBlocks(db, context.store_id, payload.chapter_id, context.user_id, payload.block_ids) }),
  },
  {
    name: 'quality.lot.block',
    description: 'Bloque un lot pour raison qualite via lotBlocking.blockLotForQuality. Execution uniquement apres confirmation humaine explicite.',
    aliases: ['execute_quality_lot_block'],
    module: 'quality',
    requiredPermission: 'stock.write',
    requiredPermissions: ['mcp.execute', 'quality.record.create', 'stock.write'],
    service: 'lotBlocking.blockLotForQuality',
    confirmationLevel: 'explicit_human',
    reversible: true,
    previewRequired: true,
    batch: false,
    payloadSchema: {
      type: 'object',
      required: ['lot_id', 'reason_type', 'reason'],
      properties: {
        lot_id: { type: 'string' },
        reason_type: { type: 'string' },
        reason: { type: 'string' },
        comment: { type: 'string' },
        quality_non_conformity_id: { type: 'string' },
      },
      additionalProperties: false,
    },
    example: { action_type: 'quality.lot.block', payload: { lot_id: 'uuid-lot', reason_type: 'supplier_recall', reason: 'Rappel fournisseur' } },
    validatePayload: normalizeLotBlockPayload,
    execute: async ({ db, context, payload }) => ({
      ok: true,
      mode: 'executed',
      action: 'quality.lot.block',
      module: 'quality',
      result: await lotBlocking.blockLotForQuality(db, {
        storeId: context.store_id,
        lotId: payload.lot_id,
        userId: context.user_id,
        reason: payload.reason,
        reasonType: payload.reason_type,
        comment: payload.comment,
        qualityNonConformityId: payload.quality_non_conformity_id,
        sourceType: 'agent_mcp_quality_lot_block',
      }),
    }),
  },
  {
    name: 'quality.lot.release',
    description: 'Libere un lot bloque qualite via lotBlocking.releaseLotForQuality. Execution uniquement apres confirmation humaine explicite.',
    aliases: ['execute_quality_lot_release'],
    module: 'quality',
    requiredPermission: 'stock.write',
    requiredPermissions: ['mcp.execute', 'quality.record.create', 'stock.write'],
    service: 'lotBlocking.releaseLotForQuality',
    confirmationLevel: 'explicit_human',
    reversible: false,
    previewRequired: true,
    batch: false,
    payloadSchema: {
      type: 'object',
      required: ['lot_id', 'reason', 'comment'],
      properties: {
        lot_id: { type: 'string' },
        reason: { type: 'string' },
        comment: { type: 'string' },
      },
      additionalProperties: false,
    },
    example: { action_type: 'quality.lot.release', payload: { lot_id: 'uuid-lot', reason: 'Controle conforme', comment: 'Validation responsable qualite' } },
    validatePayload: normalizeLotReleasePayload,
    execute: async ({ db, context, payload }) => ({
      ok: true,
      mode: 'executed',
      action: 'quality.lot.release',
      module: 'quality',
      result: await lotBlocking.releaseLotForQuality(db, {
        storeId: context.store_id,
        lotId: payload.lot_id,
        userId: context.user_id,
        reason: payload.reason,
        comment: payload.comment,
        sourceType: 'agent_mcp_quality_lot_release',
      }),
    }),
  },
  {
    name: 'quality.traceability_test.complete',
    description: 'Enregistre la validation humaine d un test de tracabilite via completeTraceabilityTest. GPT ne doit jamais choisir conforme automatiquement.',
    aliases: ['execute_traceability_test_completion'],
    module: 'quality',
    requiredPermission: 'quality.record.create',
    requiredPermissions: ['mcp.execute', 'quality.record.create'],
    service: 'traceabilityTestService.completeTraceabilityTest',
    confirmationLevel: 'explicit_human',
    reversible: false,
    previewRequired: true,
    batch: false,
    payloadSchema: {
      type: 'object',
      required: ['lot_id', 'result'],
      properties: {
        lot_id: { type: 'string' },
        result: { type: 'string', enum: ['conform', 'non_conform'] },
        observation: { type: 'string' },
        corrective_action: { type: 'string' },
        started_at: { type: 'string' },
      },
      additionalProperties: false,
    },
    example: { action_type: 'quality.traceability_test.complete', payload: { lot_id: 'uuid-lot', result: 'conform', started_at: '2026-08-16T08:00:00.000Z' } },
    validatePayload: normalizeTraceabilityTestCompletionPayload,
    execute: async ({ db, context, payload }) => ({
      ok: true,
      mode: 'executed',
      action: 'quality.traceability_test.complete',
      module: 'quality',
      result: await traceabilityTests.completeTraceabilityTest({
        db,
        storeId: context.store_id,
        lotId: payload.lot_id,
        userId: context.user_id,
        result: payload.result,
        observation: payload.observation,
        correctiveAction: payload.corrective_action,
        startedAt: payload.started_at,
      }),
    }),
  },
  {
    name: 'product_recall.create_campaign',
    description: 'Cree une campagne de retrait/rappel produit via productRecallService.createProductRecallDraft. Ne declenche jamais l envoi email.',
    aliases: ['execute_product_recall'],
    module: 'quality',
    requiredPermission: 'quality.record.create',
    requiredPermissions: ['mcp.execute', 'quality.record.create', 'stock.write'],
    service: 'productRecallService.createProductRecallDraft',
    confirmationLevel: 'explicit_human',
    reversible: false,
    previewRequired: true,
    batch: false,
    payloadSchema: {
      type: 'object',
      required: ['lot_id', 'recall_type', 'reason'],
      properties: {
        lot_id: { type: 'string' },
        recall_type: { type: 'string' },
        reason: { type: 'string' },
        comment: { type: 'string' },
      },
      additionalProperties: false,
    },
    example: { action_type: 'product_recall.create_campaign', payload: { lot_id: 'uuid-lot', recall_type: 'supplier_recall', reason: 'Alerte fournisseur' } },
    validatePayload: normalizeProductRecallPayload,
    execute: async ({ db, context, payload }) => ({
      ok: true,
      mode: 'executed',
      action: 'product_recall.create_campaign',
      module: 'quality',
      result: await productRecall.createProductRecallDraft({
        db,
        storeId: context.store_id,
        lotId: payload.lot_id,
        userId: context.user_id,
        recallType: payload.recall_type,
        reason: payload.reason,
        comment: payload.comment,
      }),
    }),
  },
  {
    name: 'product_recall.send_notifications',
    description: 'Envoie les emails de rappel produit via productRecallService.sendProductRecallNotifications. Confirmation humaine finale obligatoire; aucun email silencieux.',
    aliases: ['execute_product_recall_notifications'],
    module: 'communications',
    requiredPermission: 'communications.send',
    requiredPermissions: ['mcp.execute', 'communications.send', 'quality.record.create'],
    service: 'productRecallService.sendProductRecallNotifications',
    confirmationLevel: 'explicit_human',
    reversible: false,
    previewRequired: true,
    batch: true,
    payloadSchema: {
      type: 'object',
      required: ['campaign_id', 'recipient_ids'],
      properties: {
        campaign_id: { type: 'string' },
        recipient_ids: { type: 'array', minItems: 1, items: { type: 'string' } },
      },
      additionalProperties: false,
    },
    example: { action_type: 'product_recall.send_notifications', payload: { campaign_id: 'uuid-campaign', recipient_ids: ['uuid-recipient'] } },
    validatePayload: normalizeRecallNotificationsPayload,
    execute: async ({ dbPool, context, payload }) => ({
      ok: true,
      mode: 'executed',
      action: 'product_recall.send_notifications',
      module: 'communications',
      result: await productRecall.sendProductRecallNotifications({
        db: dbPool,
        storeId: context.store_id,
        campaignId: payload.campaign_id,
        recipientIds: payload.recipient_ids,
        userId: context.user_id,
      }),
    }),
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
