const commercial = require('../agentCommercialToolsService');
const lotBlocking = require('../quality/lotBlocking');
const qualityBlocks = require('../quality/qualityDocumentBlockService');
const qualityDiagrams = require('../quality/qualityDocumentationDiagramService');
const qualityDocumentation = require('../quality/qualityDocumentationService');
const qualityTables = require('../quality/qualityDocumentationTableService');
const qualityVersions = require('../quality/qualityDocumentationVersionService');
const traceabilityTests = require('../quality/traceabilityTestService');
const productRecall = require('../productRecallService');
const articleCreation = require('../articleCreationService');
const {
  executeArticleStorageConditionsUpdate,
  normalizeArticleStorageUpdatePayload,
} = require('../agentArticleStorageService');
const callSheet = require('../agentCallSheetService');
const pricing = require('../pricingService');

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

function normalizeTableCellPayload(payload = {}) {
  assertObject(payload, 'payload');
  return {
    table_id: assertUuidLike(payload.table_id, 'table_id'),
    row_id: text(payload.row_id) || undefined,
    row_index: Number.isInteger(Number(payload.row_index)) ? Number(payload.row_index) : undefined,
    column_id: text(payload.column_id) || undefined,
    column_label: text(payload.column_label) || undefined,
    column_index: Number.isInteger(Number(payload.column_index)) ? Number(payload.column_index) : undefined,
    expected_value: Object.prototype.hasOwnProperty.call(payload, 'expected_value') ? String(payload.expected_value ?? '') : undefined,
    value: String(payload.value ?? payload.new_value ?? ''),
  };
}

function normalizeRelinkPayload(payload = {}, idName) {
  assertObject(payload, 'payload');
  return {
    [idName]: assertUuidLike(payload[idName] || payload.id, idName),
    chapter_id: assertUuidLike(payload.chapter_id || payload.section_id, 'chapter_id'),
    block_id: text(payload.block_id) || undefined,
    position: Number.isFinite(Number(payload.position)) ? Number(payload.position) : undefined,
    is_visible: Object.prototype.hasOwnProperty.call(payload, 'is_visible') ? payload.is_visible !== false : undefined,
    dry_run: payload.dry_run === true,
  };
}

function normalizeDiagramPatchPayload(payload = {}) {
  assertObject(payload, 'payload');
  const normalized = {
    diagram_id: assertUuidLike(payload.diagram_id, 'diagram_id'),
  };
  if (text(payload.editor_mode)) normalized.editor_mode = text(payload.editor_mode);
  if (Object.prototype.hasOwnProperty.call(payload, 'title')) normalized.title = String(payload.title ?? '');
  if (text(payload.orientation)) normalized.orientation = text(payload.orientation);
  if (text(payload.node_id)) normalized.node_id = text(payload.node_id);
  if (text(payload.edge_id)) normalized.edge_id = text(payload.edge_id);
  if (text(payload.field)) normalized.field = text(payload.field);
  if (Object.prototype.hasOwnProperty.call(payload, 'value')) normalized.value = payload.value;
  if (Object.prototype.hasOwnProperty.call(payload, 'source')) normalized.source = String(payload.source || '');
  if (Object.prototype.hasOwnProperty.call(payload, 'rendered_svg')) normalized.rendered_svg = String(payload.rendered_svg || '');
  if (Object.prototype.hasOwnProperty.call(payload, 'expected_value')) normalized.expected_value = String(payload.expected_value ?? '');
  return normalized;
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
    name: 'pricing.session.create',
    description: 'Cree une session brouillon Tarification / Cours du jour via pricingService. Ne publie rien et ne modifie pas la fiche appel.',
    aliases: [],
    module: 'pricing',
    requiredPermission: 'pricing.write',
    requiredPermissions: ['mcp.execute', 'pricing.write'],
    service: 'pricingService.createPricingSession',
    confirmationLevel: 'explicit_human',
    reversible: true,
    previewRequired: true,
    batch: false,
    payloadSchema: { type: 'object', properties: { date: { type: 'string' }, pricing_date: { type: 'string' }, title: { type: 'string' }, notes: { type: 'string' } }, additionalProperties: false },
    example: { action_type: 'pricing.session.create', payload: { pricing_date: '2026-08-26' } },
    validatePayload: (payload) => { assertObject(payload, 'payload'); return payload; },
    execute: async ({ db, context, payload }) => ({ ok: true, mode: 'executed', action: 'pricing.session.create', module: 'pricing', result: await pricing.createPricingSession(db, context.store_id, payload, context) }),
  },
  {
    name: 'pricing.session.duplicate',
    description: 'Cree une session brouillon en recopiant une tarification source ou la derniere disponible, sans modifier l historique.',
    aliases: [],
    module: 'pricing',
    requiredPermission: 'pricing.write',
    requiredPermissions: ['mcp.execute', 'pricing.write'],
    service: 'pricingService.duplicatePricingSession',
    confirmationLevel: 'explicit_human',
    reversible: true,
    previewRequired: true,
    batch: false,
    payloadSchema: { type: 'object', properties: { date: { type: 'string' }, pricing_date: { type: 'string' }, source_session_id: { type: 'string' }, title: { type: 'string' }, notes: { type: 'string' } }, additionalProperties: false },
    example: { action_type: 'pricing.session.duplicate', payload: { pricing_date: '2026-08-26' } },
    validatePayload: (payload) => { assertObject(payload, 'payload'); return payload; },
    execute: async ({ db, context, payload }) => ({ ok: true, mode: 'executed', action: 'pricing.session.duplicate', module: 'pricing', result: await pricing.duplicatePricingSession(db, context.store_id, payload, context) }),
  },
  {
    name: 'pricing.line.add',
    description: 'Ajoute une ligne dans une session brouillon avec cout rendu calcule cote service et tarifs dynamiques.',
    aliases: [],
    module: 'pricing',
    requiredPermission: 'pricing.write',
    requiredPermissions: ['mcp.execute', 'pricing.write'],
    service: 'pricingService.addPricingLine',
    confirmationLevel: 'explicit_human',
    reversible: true,
    previewRequired: true,
    batch: false,
    payloadSchema: { type: 'object', required: ['pricing_session_id'], additionalProperties: true },
    example: { action_type: 'pricing.line.add', payload: { pricing_session_id: 'uuid-session', article_id: 'uuid-article', purchase_price_ht: 5.5, tariffs: [{ legacy_level: 1, price_ht: 7.9 }] } },
    validatePayload: (payload) => { assertObject(payload, 'payload'); return payload; },
    execute: async ({ db, context, payload }) => ({ ok: true, mode: 'executed', action: 'pricing.line.add', module: 'pricing', result: await pricing.addPricingLine(db, context.store_id, payload, context) }),
  },
  {
    name: 'pricing.line.update',
    description: 'Modifie une ligne de session brouillon. Les champs absents ne changent pas; les tarifs sont stockes dans pricing_line_tariffs.',
    aliases: [],
    module: 'pricing',
    requiredPermission: 'pricing.write',
    requiredPermissions: ['mcp.execute', 'pricing.write'],
    service: 'pricingService.updatePricingLine',
    confirmationLevel: 'explicit_human',
    reversible: true,
    previewRequired: true,
    batch: false,
    payloadSchema: { type: 'object', required: ['pricing_line_id'], additionalProperties: true },
    example: { action_type: 'pricing.line.update', payload: { pricing_line_id: 'uuid-ligne', purchase_price_ht: 5.5, transport_cost_ht: 0.2, tariffs: [{ legacy_level: 1, price_ht: 7.9 }] } },
    validatePayload: (payload) => { assertObject(payload, 'payload'); return payload; },
    execute: async ({ db, context, payload }) => ({ ok: true, mode: 'executed', action: 'pricing.line.update', module: 'pricing', result: await pricing.updatePricingLine(db, context.store_id, payload, context) }),
  },
  {
    name: 'pricing.line.remove',
    description: 'Retire une ligne d une session brouillon. Les sessions publiees restent non modifiables.',
    aliases: [],
    module: 'pricing',
    requiredPermission: 'pricing.write',
    requiredPermissions: ['mcp.execute', 'pricing.write'],
    service: 'pricingService.removePricingLine',
    confirmationLevel: 'explicit_human',
    reversible: false,
    previewRequired: true,
    batch: false,
    payloadSchema: { type: 'object', required: ['pricing_line_id'], properties: { pricing_line_id: { type: 'string' } }, additionalProperties: false },
    example: { action_type: 'pricing.line.remove', payload: { pricing_line_id: 'uuid-ligne' } },
    validatePayload: (payload) => { assertObject(payload, 'payload'); return payload; },
    execute: async ({ db, context, payload }) => ({ ok: true, mode: 'executed', action: 'pricing.line.remove', module: 'pricing', result: await pricing.removePricingLine(db, context.store_id, payload, context) }),
  },
  {
    name: 'pricing.supplier_import.create',
    description: 'Importe un cours fournisseur texte/lignes structurees, effectue un matching deterministe, sans IA et sans creation automatique d article.',
    aliases: [],
    module: 'pricing',
    requiredPermission: 'pricing.write',
    requiredPermissions: ['mcp.execute', 'pricing.write'],
    service: 'pricingService.createSupplierPriceImport',
    confirmationLevel: 'explicit_human',
    reversible: true,
    previewRequired: true,
    batch: false,
    payloadSchema: { type: 'object', required: ['supplier_id'], additionalProperties: true },
    example: { action_type: 'pricing.supplier_import.create', payload: { supplier_id: 'uuid-fournisseur', raw_text: 'F JULIENNE 10.50' } },
    validatePayload: (payload) => { assertObject(payload, 'payload'); return payload; },
    execute: async ({ db, context, payload }) => ({ ok: true, mode: 'executed', action: 'pricing.supplier_import.create', module: 'pricing', result: await pricing.createSupplierPriceImport(db, context.store_id, payload, context) }),
  },
  {
    name: 'pricing.supplier_import.apply',
    description: 'Applique les lignes confirmees ou corrigees humainement d un import fournisseur a une session brouillon.',
    aliases: [],
    module: 'pricing',
    requiredPermission: 'pricing.write',
    requiredPermissions: ['mcp.execute', 'pricing.write'],
    service: 'pricingService.applySupplierImportToSession',
    confirmationLevel: 'explicit_human',
    reversible: true,
    previewRequired: true,
    batch: false,
    payloadSchema: { type: 'object', required: ['import_id', 'pricing_session_id'], properties: { import_id: { type: 'string' }, pricing_session_id: { type: 'string' } }, additionalProperties: false },
    example: { action_type: 'pricing.supplier_import.apply', payload: { import_id: 'uuid-import', pricing_session_id: 'uuid-session' } },
    validatePayload: (payload) => { assertObject(payload, 'payload'); return payload; },
    execute: async ({ db, context, payload }) => ({ ok: true, mode: 'executed', action: 'pricing.supplier_import.apply', module: 'pricing', result: await pricing.applySupplierImportToSession(db, context.store_id, payload, context) }),
  },
  {
    name: 'pricing.supplier_import_line.confirm',
    description: 'Confirme humainement le rapprochement propose pour une ligne import fournisseur et memorise le mapping fournisseur.',
    aliases: [],
    module: 'pricing',
    requiredPermission: 'pricing.write',
    requiredPermissions: ['mcp.execute', 'pricing.write'],
    service: 'pricingService.confirmSupplierImportLineMapping',
    confirmationLevel: 'explicit_human',
    reversible: true,
    previewRequired: true,
    batch: false,
    payloadSchema: { type: 'object', required: ['import_line_id'], properties: { import_line_id: { type: 'string' }, article_id: { type: 'string' } }, additionalProperties: false },
    example: { action_type: 'pricing.supplier_import_line.confirm', payload: { import_line_id: 'uuid-ligne-import' } },
    validatePayload: (payload) => { assertObject(payload, 'payload'); return payload; },
    execute: async ({ db, context, payload }) => ({ ok: true, mode: 'executed', action: 'pricing.supplier_import_line.confirm', module: 'pricing', result: await pricing.confirmSupplierImportLineMapping(db, context.store_id, payload, context) }),
  },
  {
    name: 'pricing.supplier_import_line.override',
    description: 'Remplace humainement l article associe a une ligne import fournisseur et memorise le nouveau mapping.',
    aliases: [],
    module: 'pricing',
    requiredPermission: 'pricing.write',
    requiredPermissions: ['mcp.execute', 'pricing.write'],
    service: 'pricingService.overrideSupplierImportLineMapping',
    confirmationLevel: 'explicit_human',
    reversible: true,
    previewRequired: true,
    batch: false,
    payloadSchema: { type: 'object', required: ['import_line_id', 'article_id'], properties: { import_line_id: { type: 'string' }, article_id: { type: 'string' } }, additionalProperties: false },
    example: { action_type: 'pricing.supplier_import_line.override', payload: { import_line_id: 'uuid-ligne-import', article_id: 'uuid-article' } },
    validatePayload: (payload) => { assertObject(payload, 'payload'); return payload; },
    execute: async ({ db, context, payload }) => ({ ok: true, mode: 'executed', action: 'pricing.supplier_import_line.override', module: 'pricing', result: await pricing.overrideSupplierImportLineMapping(db, context.store_id, payload, context) }),
  },
  {
    name: 'pricing.supplier_import_line.ignore',
    description: 'Ignore humainement une ligne import fournisseur pour qu elle ne soit jamais appliquee a la session.',
    aliases: [],
    module: 'pricing',
    requiredPermission: 'pricing.write',
    requiredPermissions: ['mcp.execute', 'pricing.write'],
    service: 'pricingService.ignoreSupplierImportLine',
    confirmationLevel: 'explicit_human',
    reversible: true,
    previewRequired: true,
    batch: false,
    payloadSchema: { type: 'object', required: ['import_line_id'], properties: { import_line_id: { type: 'string' } }, additionalProperties: false },
    example: { action_type: 'pricing.supplier_import_line.ignore', payload: { import_line_id: 'uuid-ligne-import' } },
    validatePayload: (payload) => { assertObject(payload, 'payload'); return payload; },
    execute: async ({ db, context, payload }) => ({ ok: true, mode: 'executed', action: 'pricing.supplier_import_line.ignore', module: 'pricing', result: await pricing.ignoreSupplierImportLine(db, context.store_id, payload, context) }),
  },
  {
    name: 'pricing.supplier_mapping.upsert',
    description: 'Cree ou corrige une correspondance fournisseur/article ALTA pour ce fournisseur uniquement.',
    aliases: [],
    module: 'pricing',
    requiredPermission: 'pricing.write',
    requiredPermissions: ['mcp.execute', 'pricing.write'],
    service: 'pricingService.upsertSupplierArticleMapping',
    confirmationLevel: 'explicit_human',
    reversible: true,
    previewRequired: true,
    batch: false,
    payloadSchema: { type: 'object', required: ['supplier_id', 'article_id', 'supplier_designation_original'], additionalProperties: true },
    example: { action_type: 'pricing.supplier_mapping.upsert', payload: { supplier_id: 'uuid-fournisseur', article_id: 'uuid-article', supplier_designation_original: 'F JULIENNE' } },
    validatePayload: (payload) => { assertObject(payload, 'payload'); return payload; },
    execute: async ({ db, context, payload }) => ({ ok: true, mode: 'executed', action: 'pricing.supplier_mapping.upsert', module: 'pricing', result: await pricing.upsertSupplierArticleMapping(db, context.store_id, payload, context) }),
  },
  {
    name: 'pricing.session.publish',
    description: 'Publie transactionnellement une session brouillon: remplace la publication active de la date et synchronise le miroir fiche appel.',
    aliases: [],
    module: 'pricing',
    requiredPermission: 'pricing.write',
    requiredPermissions: ['mcp.execute', 'pricing.write'],
    service: 'pricingService.publishPricingSession',
    confirmationLevel: 'explicit_human',
    reversible: false,
    previewRequired: true,
    batch: false,
    payloadSchema: { type: 'object', required: ['pricing_session_id'], properties: { pricing_session_id: { type: 'string' }, sync_call_sheet: { type: 'boolean' } }, additionalProperties: false },
    example: { action_type: 'pricing.session.publish', payload: { pricing_session_id: 'uuid-session', sync_call_sheet: true } },
    validatePayload: (payload) => { assertObject(payload, 'payload'); return payload; },
    execute: async ({ db, context, payload }) => ({ ok: true, mode: 'executed', action: 'pricing.session.publish', module: 'pricing', result: await pricing.publishPricingSession(db, context.store_id, payload, context) }),
  },
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
    name: 'articles.create',
    description: 'Cree un Article via le service metier partage par POST /api/articles. Ecriture store-scoped, sans acces SQL generique ni modification de stock, lots, achats ou ventes.',
    aliases: ['article.create', 'create_article', 'articles_create'],
    module: 'articles',
    requiredPermission: 'articles.write',
    requiredPermissions: ['mcp.execute', 'articles.write'],
    service: 'articleCreationService.createArticle',
    confirmationLevel: 'explicit_human',
    reversible: false,
    previewRequired: true,
    batch: false,
    payloadSchema: {
      type: 'object',
      required: ['plu', 'designation'],
      properties: Object.fromEntries(articleCreation.AGENT_ARTICLE_CREATE_FIELDS.map((field) => {
        if (field === 'is_active') return [field, { type: 'boolean' }];
        if (['vat_rate', 'purchase_price_ex_vat', 'sale_price_ex_vat', 'sale_price_inc_vat', 'storage_temperature_min', 'storage_temperature_max'].includes(field)) {
          return [field, { type: ['number', 'string', 'null'] }];
        }
        if (field === 'article_category') return [field, { type: 'string', enum: ['product', 'packaging'] }];
        return [field, { type: ['string', 'null'] }];
      })),
      additionalProperties: false,
    },
    example: {
      action_type: 'articles.create',
      payload: {
        plu: 'BAR-SAUVAGE-12KG',
        designation: 'Bar sauvage 1/2 kg',
        unit: 'kg',
        article_category: 'product',
        vat_rate: 5.5,
      },
    },
    validatePayload: articleCreation.normalizeAgentArticleCreatePayload,
    execute: articleCreation.executeAgentArticleCreate,
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
    name: 'quality.documentation.update_table_cell',
    description: 'Modifie une seule cellule dans quality_document_tables.table_data avec verification optionnelle de l ancienne valeur.',
    aliases: ['update_quality_table_cell'],
    module: 'quality_documentation',
    requiredPermission: 'quality.documentation.edit',
    requiredPermissions: ['mcp.execute', 'quality.documentation.edit'],
    service: 'qualityDocumentationTableService.updateTableCell',
    confirmationLevel: 'explicit_human',
    reversible: true,
    previewRequired: false,
    batch: false,
    payloadSchema: {
      type: 'object',
      required: ['table_id', 'value'],
      properties: {
        table_id: { type: 'string' },
        row_id: { type: 'string' },
        row_index: { type: 'integer', minimum: 0 },
        column_id: { type: 'string' },
        column_label: { type: 'string' },
        column_index: { type: 'integer', minimum: 0 },
        expected_value: { type: 'string' },
        value: { type: 'string' },
        new_value: { type: 'string' },
      },
      additionalProperties: false,
    },
    example: { action_type: 'quality.documentation.update_table_cell', payload: { table_id: 'uuid-table', row_id: 'row-1', column_id: 'action', expected_value: 'Ancien texte', value: 'Nouveau texte' } },
    validatePayload: normalizeTableCellPayload,
    execute: async ({ db, context, payload }) => ({
      ok: true,
      mode: 'executed',
      action: 'quality.documentation.update_table_cell',
      module: 'quality_documentation',
      result: await qualityTables.updateTableCell(db, context.store_id, payload.table_id, context.user_id, payload),
    }),
  },
  {
    name: 'quality.documentation.relink_table',
    description: 'Rattache ou repositionne un tableau existant sans changer son id ni son table_data.',
    aliases: ['relink_quality_table'],
    module: 'quality_documentation',
    requiredPermission: 'quality.documentation.edit',
    requiredPermissions: ['mcp.execute', 'quality.documentation.edit'],
    service: 'qualityDocumentationTableService.relinkTable',
    confirmationLevel: 'explicit_human',
    reversible: true,
    previewRequired: true,
    batch: false,
    payloadSchema: {
      type: 'object',
      required: ['table_id', 'chapter_id'],
      properties: {
        table_id: { type: 'string' },
        chapter_id: { type: 'string' },
        section_id: { type: 'string' },
        block_id: { type: 'string' },
        position: { type: 'number' },
        is_visible: { type: 'boolean' },
        dry_run: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    example: { action_type: 'quality.documentation.relink_table', payload: { table_id: 'uuid-table', section_id: 'uuid-section', position: 120, dry_run: true } },
    validatePayload: (payload) => normalizeRelinkPayload(payload, 'table_id'),
    execute: async ({ db, context, payload }) => ({
      ok: true,
      mode: payload.dry_run ? 'dry_run' : 'executed',
      action: 'quality.documentation.relink_table',
      module: 'quality_documentation',
      result: await qualityTables.relinkTable(db, context.store_id, payload.table_id, context.user_id, payload),
    }),
  },
  {
    name: 'quality.documentation.update_diagram',
    description: 'Modifie de facon ciblee un diagramme existant: titre, source Mermaid, libelle/annotation de noeud ou liaison.',
    aliases: ['update_quality_diagram'],
    module: 'quality_documentation',
    requiredPermission: 'quality.documentation.edit',
    requiredPermissions: ['mcp.execute', 'quality.documentation.edit'],
    service: 'qualityDocumentationDiagramService.patchDiagram',
    confirmationLevel: 'explicit_human',
    reversible: true,
    previewRequired: false,
    batch: false,
    payloadSchema: {
      type: 'object',
      required: ['diagram_id'],
      properties: {
        diagram_id: { type: 'string' },
        editor_mode: { type: 'string', enum: ['structured', 'mermaid'] },
        title: { type: 'string' },
        orientation: { type: 'string', enum: ['vertical', 'horizontal'] },
        node_id: { type: 'string' },
        edge_id: { type: 'string' },
        field: { type: 'string' },
        value: {},
        source: { type: 'string' },
        rendered_svg: { type: 'string' },
        expected_value: { type: 'string' },
      },
      additionalProperties: false,
    },
    example: { action_type: 'quality.documentation.update_diagram', payload: { diagram_id: 'uuid-diagram', node_id: 'reception', field: 'label', expected_value: 'Ancien', value: 'Nouveau' } },
    validatePayload: normalizeDiagramPatchPayload,
    execute: async ({ db, context, payload }) => ({
      ok: true,
      mode: 'executed',
      action: 'quality.documentation.update_diagram',
      module: 'quality_documentation',
      result: await qualityDiagrams.patchDiagram(db, context.store_id, payload.diagram_id, context.user_id, payload),
    }),
  },
  {
    name: 'quality.documentation.relink_diagram',
    description: 'Rattache ou repositionne un diagramme existant sans changer son id ni son diagram_data/source.',
    aliases: ['relink_quality_diagram'],
    module: 'quality_documentation',
    requiredPermission: 'quality.documentation.edit',
    requiredPermissions: ['mcp.execute', 'quality.documentation.edit'],
    service: 'qualityDocumentationDiagramService.relinkDiagram',
    confirmationLevel: 'explicit_human',
    reversible: true,
    previewRequired: true,
    batch: false,
    payloadSchema: {
      type: 'object',
      required: ['diagram_id', 'chapter_id'],
      properties: {
        diagram_id: { type: 'string' },
        chapter_id: { type: 'string' },
        section_id: { type: 'string' },
        block_id: { type: 'string' },
        position: { type: 'number' },
        is_visible: { type: 'boolean' },
        dry_run: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    example: { action_type: 'quality.documentation.relink_diagram', payload: { diagram_id: 'uuid-diagram', section_id: 'uuid-section', dry_run: true } },
    validatePayload: (payload) => normalizeRelinkPayload(payload, 'diagram_id'),
    execute: async ({ db, context, payload }) => ({
      ok: true,
      mode: payload.dry_run ? 'dry_run' : 'executed',
      action: 'quality.documentation.relink_diagram',
      module: 'quality_documentation',
      result: await qualityDiagrams.relinkDiagram(db, context.store_id, payload.diagram_id, context.user_id, payload),
    }),
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
