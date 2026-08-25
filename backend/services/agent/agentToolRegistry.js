const commercial = require('../agentCommercialToolsService');
const cashflow = require('../cashflow/service');
const qualityDocumentation = require('../quality/qualityDocumentationService');
const qualityVersions = require('../quality/qualityDocumentationVersionService');
const qualityTables = require('../quality/qualityDocumentationTableService');
const qualityDiagrams = require('../quality/qualityDocumentationDiagramService');
const qualityExport = require('../quality/qualityDocumentationExportService');
const qualityContext = require('../quality/agentQualityContextService');
const qualityStructuredInventory = require('../quality/qualityStructuredObjectInventoryService');
const qualityConfiguration = require('../quality/agentConfiguration');
const qualityTemperatures = require('../quality/temperatures');
const qualityCleaning = require('../quality/cleaning');
const qualityOperations = require('../quality/operations');
const qualityMasterDocuments = require('../quality/masterDocuments');
const suppliesMaterials = require('../quality/suppliesMaterials');
const agentQualityRecall = require('./agentQualityTraceabilityRecallService');
const { normalizeArticleStorageUpdatePayload } = require('../agentArticleStorageService');
const { AGENT_ARTICLE_CREATE_FIELDS, normalizeAgentArticleCreatePayload } = require('../articleCreationService');
const callSheet = require('../agentCallSheetService');
const temperatureValidators = require('../../validators/quality/temperatures');
const cleaningValidators = require('../../validators/quality/cleaning');
const fullCoverage = require('./agentFullCoverageService');
const { listModules, getModule } = require('./agentModuleCatalog');
const { listAgentAuditLogs, getAgentAuditLog } = require('./agentAuditService');
const {
  createExecutablePendingAction,
  executeExecutableActionDirect,
  executeExecutablePendingAction,
  listExecutableActions,
} = require('./agentActionOrchestratorService');
const {
  RISK_LEVELS,
  structuredToolOutputSchema,
  emptyInputSchema,
  searchInputSchema,
  periodInputSchema,
  idInputSchema,
} = require('./agentToolSchemas');

function nowFreshness(lastSyncAt = null) {
  return { generated_at: new Date().toISOString(), last_sync_at: lastSyncAt };
}

function response({ tool, domain, summary, data = {}, warnings = [], missing_information = [], audit_id = null, source_freshness = null }) {
  return {
    ok: true,
    tool,
    domain,
    summary,
    data,
    warnings,
    missing_information,
    source_freshness: source_freshness || nowFreshness(),
    audit_id,
  };
}

function text(value) {
  return String(value || '').trim();
}

function limit(value, fallback = 50, max = 100) {
  const parsed = Number(value);
  return Math.min(Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback, max);
}

async function findQualitySection(db, storeId, input = {}) {
  return qualityContext.findQualitySection(db, storeId, input);
}

async function resolveQualitySectionId(db, storeId, input = {}) {
  if (input.chapter_id) return input.chapter_id;
  if (input.section_id) return input.section_id;
  const section = await findQualitySection(db, storeId, {
    section_id: input.section_id,
    code: input.section_code || input.code,
    query: input.query,
  });
  if (!section?.id) {
    const error = new Error('Chapitre qualite introuvable: fournir chapter_id, section_id ou section_code');
    error.status = 404;
    error.expose = true;
    throw error;
  }
  return section.id;
}

async function executeQualitySectionCanonicalUpdate(dbPool, context, input = {}) {
  const before = await findQualitySection(dbPool, context.store_id, input);
  const sectionId = before?.id || input.section_id || input.chapter_id;
  if (!sectionId) {
    const error = new Error('Chapitre qualite introuvable: fournir section_id ou section_code');
    error.status = 404;
    error.expose = true;
    throw error;
  }
  const actionResult = await executeExecutableActionDirect({
    dbPool,
    context,
    actionType: 'quality.documentation.apply_section_updates',
    payload: {
      mode: 'all_or_nothing',
      updates: [
        {
          section_id: sectionId,
          content_html: input.content_html,
          status: input.status,
          comment_internal: input.comment_internal,
          change_summary: input.change_summary,
        },
      ],
    },
  });
  const section = await findQualitySection(dbPool, context.store_id, { section_id: sectionId });
  const versions = section ? await qualityVersions.listSectionVersions(dbPool, context.store_id, section.id) : [];
  return { before, section, versions, actionResult };
}

function tableDataFromInput(input = {}) {
  return {
    title: input.title,
    columns: input.columns,
    rows: input.rows,
    header: input.header,
  };
}

function diagramDataFromInput(input = {}) {
  return {
    title: input.title,
    orientation: input.orientation,
    nodes: input.nodes,
    edges: input.edges || input.connections,
    editor_mode: input.editor_mode,
    source: input.source,
    rendered_svg: input.rendered_svg,
  };
}

const qualityStructuredInventoryListInputSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['all', 'active', 'archived', 'attached', 'unattached', 'hidden'] },
    filter: { type: 'string', enum: ['all', 'active', 'archived', 'attached', 'unattached', 'hidden'] },
    section_id: { type: 'string' },
    collection_id: { type: 'string' },
    query: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 250 },
    offset: { type: 'integer', minimum: 0 },
  },
  additionalProperties: false,
};

const QUALITY_BLOCK_ACTIONS_WITH_CHAPTER = new Set([
  'quality.documentation.add_text_block',
  'quality.documentation.add_table_block',
  'quality.documentation.add_diagram_block',
  'quality.documentation.move_block',
  'quality.documentation.relink_table',
  'quality.documentation.relink_diagram',
]);

const qualityPlanningProperties = {
  planning_mode: { type: 'string', enum: ['existing', 'new', 'none'] },
  task_mode: { type: 'string', enum: ['existing', 'new', 'none'] },
  task_title: { type: 'string' },
  responsible_user_id: { type: 'string' },
  frequency_value: { type: 'integer', minimum: 1 },
  frequency_unit: { type: 'string', enum: ['hours', 'days', 'weeks', 'months', 'events'] },
  target_time: { type: 'string' },
};

const qualityTaskConfigurationInputSchema = {
  type: 'object',
  required: ['title'],
  properties: {
    task_id: { type: 'string' },
    title: { type: 'string' },
    description: { type: 'string' },
    category: { type: 'string' },
    module_key: { type: 'string' },
    zone_id: { type: 'string' },
    equipment_id: { type: 'string' },
    frequency_value: { type: 'integer', minimum: 1 },
    frequency_unit: { type: 'string', enum: ['hours', 'days', 'weeks', 'months', 'events'] },
    target_time: { type: 'string' },
    next_due_at: { type: 'string' },
    responsible_user_id: { type: 'string' },
    responsible_role: { type: 'string' },
    criticality: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
    execution_method: { type: 'string' },
    verification_method: { type: 'string' },
    proof_required: { type: 'boolean' },
    photo_required: { type: 'boolean' },
    status: { type: 'string', enum: ['draft', 'pending_review', 'planned', 'paused', 'cancelled'] },
    instructions: { type: 'string' },
    acceptance_criteria: { type: 'string' },
    deviation_action: { type: 'string' },
    configuration_status: { type: 'string', enum: ['draft', 'pending_review', 'active', 'inactive', 'archived'] },
    active: { type: 'boolean' },
    agent_action_id: { type: 'string' },
  },
  additionalProperties: false,
};

const qualityCleaningPlanConfigurationInputSchema = {
  type: 'object',
  required: ['title'],
  properties: {
    cleaning_plan_id: { type: 'string' },
    plan_id: { type: 'string' },
    title: { type: 'string' },
    description: { type: 'string' },
    zone_id: { type: 'string' },
    equipment_id: { type: 'string' },
    zone_ids: { type: 'array', items: { type: 'string' }, description: 'Zones couvertes par le plan. Compatible avec zone_id legacy.' },
    equipment_ids: { type: 'array', items: { type: 'string' }, description: 'Equipements couverts par le plan. Compatible avec equipment_id legacy.' },
    scheduled_days: { type: 'array', items: { type: 'string' }, description: 'Jours de planification portes par le plan PMS.' },
    quality_task_id: { type: 'string' },
    product_name: { type: 'string' },
    supply_material_id: { type: 'string', description: 'Produit/fourniture du referentiel central. product_name reste compatible pendant la transition.' },
    dosage_concentration: { type: 'string' },
    usage_temperature: { type: 'string' },
    contact_time_minutes: { type: 'integer', minimum: 1 },
    rinse_required: { type: 'boolean' },
    material_used: { type: 'string' },
    method: { type: 'string' },
    safety_instructions: { type: 'string' },
    expected_duration_minutes: { type: 'integer', minimum: 1 },
    post_cleaning_check: { type: 'string' },
    expected_proof: { type: 'string' },
    corrective_action: { type: 'string' },
    configuration_status: { type: 'string', enum: ['draft', 'pending_review', 'active', 'inactive', 'archived'] },
    active: { type: 'boolean' },
    agent_action_id: { type: 'string' },
    ...qualityPlanningProperties,
  },
  additionalProperties: false,
};

const qualityTemperatureParameterInputSchema = {
  type: 'object',
  required: ['type_code'],
  properties: {
    temperature_parameter_id: { type: 'string' },
    parameter_id: { type: 'string' },
    limit_id: { type: 'string' },
    type_code: { type: 'string', description: 'Code actif retourne par list_quality_temperature_types. Ne pas inventer de code.' },
    type: { type: 'string', description: 'Alias legacy de type_code. Preferer type_code avec un code retourne par list_quality_temperature_types.' },
    zone_id: { type: 'string' },
    equipment_id: { type: 'string' },
    min_value: { type: 'number' },
    max_value: { type: 'number' },
    unit: { type: 'string' },
    expected_frequency_value: { type: 'integer', minimum: 1 },
    expected_frequency_unit: { type: 'string', enum: ['hours', 'days', 'events'] },
    target_time: { type: 'string' },
    target_times: { type: 'array', items: { type: 'string' }, description: 'Horaires cibles multiples du parametre temperature, format HH:mm.' },
    scheduled_days: { type: 'array', items: { type: 'string', enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] }, description: 'Jours actifs du parametre temperature ALTA. Dimanche est ferme.' },
    quality_task_id: { type: 'string' },
    is_active: { type: 'boolean' },
    valid_from: { type: 'string' },
    valid_until: { type: 'string' },
    ...qualityPlanningProperties,
  },
  additionalProperties: false,
};

const qualityParameterStatusInputSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    temperature_parameter_id: { type: 'string' },
    parameter_id: { type: 'string' },
    limit_id: { type: 'string' },
  },
  additionalProperties: false,
};

const qualityOccurrenceExecutionInputSchema = {
  type: 'object',
  properties: {
    occurrence_id: { type: 'string' },
    quality_task_id: { type: 'string' },
    type_code: { type: 'string' },
    value: { type: 'number' },
    unit: { type: 'string' },
    cleaning_plan_id: { type: 'string' },
    status: { type: 'string' },
    recorded_at: { type: 'string' },
    performed_at: { type: 'string' },
    completed_at: { type: 'string' },
    operator_user_id: { type: 'string' },
    performed_by: { type: 'string' },
    comment: { type: 'string' },
    observation: { type: 'string' },
    corrective_action: { type: 'string' },
    anomaly_comment: { type: 'string' },
    visual_check_status: { type: 'string', enum: ['conform', 'non_conform', 'not_applicable'] },
    result_status: { type: 'string', enum: ['completed', 'partial', 'not_applicable', 'issue'] },
    conformity_status: { type: 'string', enum: ['conform', 'non_conform', 'not_applicable'] },
    method_used: { type: 'string' },
    evidence_photo_id: { type: 'string' },
    evidence_document_id: { type: 'string' },
  },
  additionalProperties: false,
};

const qualityNonConformityInputSchema = {
  type: 'object',
  required: ['description'],
  properties: {
    origin_type: { type: 'string' },
    origin_record_id: { type: 'string' },
    source_record_type: { type: 'string' },
    source_record_id: { type: 'string' },
    quality_task_id: { type: 'string' },
    occurrence_id: { type: 'string' },
    source_entity_type: { type: 'string' },
    source_entity_id: { type: 'string' },
    zone_id: { type: 'string' },
    equipment_id: { type: 'string' },
    severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
    title: { type: 'string' },
    description: { type: 'string' },
    immediate_action: { type: 'string' },
    responsible_user_id: { type: 'string' },
    due_at: { type: 'string' },
    closure_validation_required: { type: 'boolean' },
  },
  additionalProperties: false,
};

const qualityCorrectiveActionInputSchema = {
  type: 'object',
  required: ['action'],
  properties: {
    non_conformity_id: { type: 'string' },
    quality_task_id: { type: 'string' },
    action: { type: 'string' },
    responsible_user_id: { type: 'string' },
    due_at: { type: 'string' },
    proof_document_id: { type: 'string' },
    proof_photo_id: { type: 'string' },
    effectiveness_check: { type: 'string' },
    validation_comment: { type: 'string' },
  },
  additionalProperties: false,
};

const supplyMaterialInputSchema = {
  type: 'object',
  required: ['name', 'category'],
  properties: {
    supply_material_id: { type: 'string' },
    material_id: { type: 'string' },
    code: { type: 'string' },
    name: { type: 'string' },
    category: { type: 'string', enum: suppliesMaterials.SUPPLY_MATERIAL_CATEGORIES },
    subcategory: { type: 'string' },
    description: { type: 'string' },
    brand: { type: 'string' },
    manufacturer: { type: 'string' },
    supplier_id: { type: 'string' },
    supplier_reference: { type: 'string' },
    order_url: { type: 'string' },
    image_document_id: { type: 'string' },
    unit: { type: 'string' },
    packaging: { type: 'string' },
    purchase_price: { type: 'number' },
    minimum_stock: { type: 'number' },
    current_stock: { type: 'number' },
    metadata: { type: 'object', additionalProperties: true },
    active: { type: 'boolean' },
    notes: { type: 'string' },
  },
  additionalProperties: false,
};

const supplyMaterialLinkInputSchema = {
  type: 'object',
  required: ['supply_material_id', 'target_type'],
  properties: {
    supply_material_id: { type: 'string' },
    material_id: { type: 'string' },
    target_type: { type: 'string', enum: suppliesMaterials.SUPPLY_MATERIAL_LINK_TYPES },
    target_id: { type: 'string' },
    target_code: { type: 'string' },
    relation_type: { type: 'string' },
    notes: { type: 'string' },
  },
  additionalProperties: false,
};

const qualityMasterDocumentInputSchema = {
  type: 'object',
  required: ['title', 'document_type'],
  properties: {
    document_id: { type: 'string' },
    title: { type: 'string' },
    document_type: { type: 'string' },
    category: { type: 'string' },
    source_type: { type: 'string', enum: ['CCI', 'laboratoire', 'prestataire', 'administration', 'fournisseur', 'interne'] },
    issuer_name: { type: 'string' },
    reference_number: { type: 'string' },
    issue_date: { type: 'string' },
    valid_from: { type: 'string' },
    valid_until: { type: 'string' },
    version: { type: 'string' },
    status: { type: 'string', enum: ['draft', 'valid', 'expired', 'replaced', 'archived'] },
    original_filename: { type: 'string' },
    storage_path: { type: 'string' },
    mime_type: { type: 'string' },
    file_size: { type: 'integer' },
    checksum_sha256: { type: 'string' },
    description: { type: 'string' },
  },
  additionalProperties: false,
};

const qualityDocumentReferenceInputSchema = {
  type: 'object',
  required: ['document_id', 'target_type'],
  properties: {
    reference_id: { type: 'string' },
    document_id: { type: 'string' },
    target_type: { type: 'string', enum: ['documentation_section', 'document_block', 'quality_object', 'temperature', 'cleaning', 'manual_task', 'quality_temperature_record', 'quality_cleaning_record', 'cleaning_plan', 'temperature_parameter', 'non_conformity', 'corrective_action', 'ddpp_view', 'procedure'] },
    target_id: { type: 'string' },
    relation_type: { type: 'string' },
    label: { type: 'string' },
    sort_order: { type: 'integer' },
  },
  additionalProperties: false,
};

const qualityMissingItemInputSchema = {
  type: 'object',
  properties: {
    missing_item_id: { type: 'string' },
    id: { type: 'string' },
    collection_id: { type: 'string' },
    section_id: { type: 'string' },
    description: { type: 'string' },
    severity: { type: 'string', enum: ['normal', 'blocking', 'low', 'medium', 'high', 'critical', 'before_submission', 'before_opening', 'future', 'after_instruction', 'to_confirm', 'external_pending'] },
    responsible_user_id: { type: 'string' },
    due_at: { type: ['string', 'null'] },
    reason: { type: 'string' },
    confirmation: { type: 'string', enum: ['human_confirmed'] },
    pending_action_id: { type: 'string' },
  },
  additionalProperties: false,
};

const qualityDocumentationExportInputSchema = {
  type: 'object',
  required: ['collection_id'],
  properties: {
    collection_id: { type: 'string' },
    export_type: { type: 'string' },
    profile: { type: 'string', enum: ['ddpp'] },
    tome_id: { type: 'string' },
    only_validated: { type: 'boolean' },
    include_missing: { type: 'boolean' },
    include_attachments: { type: 'boolean' },
    include_master_annexes: { type: 'boolean' },
    include_external_master_documents: { type: 'boolean' },
    include_enr_examples: { type: 'boolean' },
    confirmation: { type: 'string', enum: ['human_confirmed'] },
    pending_action_id: { type: 'string' },
  },
  additionalProperties: false,
};

const qualityTaskAssignmentInputSchema = {
  type: 'object',
  required: ['task_id'],
  properties: {
    task_id: { type: 'string' },
    zone_id: { type: 'string' },
    equipment_id: { type: 'string' },
    agent_action_id: { type: 'string' },
  },
  additionalProperties: false,
};

const qualityConfigurationStatusInputSchema = {
  type: 'object',
  required: ['type'],
  properties: {
    type: { type: 'string', enum: ['task', 'quality_task', 'cleaning_plan', 'plan'] },
    id: { type: 'string' },
    task_id: { type: 'string' },
    cleaning_plan_id: { type: 'string' },
    plan_id: { type: 'string' },
    agent_action_id: { type: 'string' },
  },
  additionalProperties: false,
};

const preparationInputSchema = {
  type: 'object',
  properties: {
    action_type: { type: 'string', maxLength: 120 },
    summary: { type: 'string', maxLength: 500 },
    impact: { type: 'string', maxLength: 1000 },
    target_objects: { type: 'array', items: { type: 'object', additionalProperties: true } },
    payload: { type: 'object', additionalProperties: true },
  },
  additionalProperties: true,
};

const articleStorageUpdateInputSchema = {
  type: 'object',
  required: ['article_id', 'changes'],
  properties: {
    article_id: { type: 'string' },
    summary: { type: 'string', maxLength: 500 },
    impact: { type: 'string', maxLength: 1000 },
    target_objects: { type: 'array', items: { type: 'object', additionalProperties: true } },
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
};
const articleStoragePrepareInputFields = new Set(['article_id', 'summary', 'impact', 'target_objects', 'changes']);
const articleCreateInputSchema = {
  type: 'object',
  required: ['plu', 'designation'],
  properties: {
    ...Object.fromEntries(AGENT_ARTICLE_CREATE_FIELDS.map((field) => {
      if (field === 'is_active') return [field, { type: 'boolean' }];
      if (['vat_rate', 'purchase_price_ex_vat', 'sale_price_ex_vat', 'sale_price_inc_vat', 'storage_temperature_min', 'storage_temperature_max'].includes(field)) {
        return [field, { type: ['number', 'string', 'null'] }];
      }
      if (field === 'article_category') return [field, { type: 'string', enum: ['product', 'packaging'] }];
      return [field, { type: ['string', 'null'] }];
    })),
    summary: { type: 'string', maxLength: 500 },
    impact: { type: 'string', maxLength: 1000 },
    target_objects: { type: 'array', items: { type: 'object', additionalProperties: true } },
  },
  additionalProperties: false,
};
const articleCreatePrepareInputFields = new Set([...AGENT_ARTICLE_CREATE_FIELDS, 'summary', 'impact', 'target_objects']);

const callSheetReadInputSchema = {
  type: 'object',
  properties: {
    sheet_id: { type: 'string' },
    id: { type: 'string' },
    date: { type: 'string', maxLength: 10 },
    sheet_date: { type: 'string', maxLength: 10 },
    date_from: { type: 'string', maxLength: 10 },
    date_to: { type: 'string', maxLength: 10 },
    supplier_id: { type: 'string' },
    query: { type: 'string', maxLength: 200 },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
  },
  additionalProperties: false,
};

const callSheetLineInputSchema = {
  type: 'object',
  minProperties: 1,
  properties: {
    article_id: { type: ['string', 'null'] },
    designation: { type: ['string', 'null'] },
    supplier_id: { type: ['string', 'null'] },
    purchase_price: { type: ['number', 'string', 'null'] },
    purchase_price_ht: { type: ['number', 'string', 'null'] },
    unit: { type: ['string', 'null'] },
    price_unit: { type: ['string', 'null'] },
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

const callSheetAddLineInputSchema = {
  type: 'object',
  required: ['sheet_id', 'line'],
  properties: {
    sheet_id: { type: 'string' },
    line: callSheetLineInputSchema,
    summary: { type: 'string', maxLength: 500 },
    impact: { type: 'string', maxLength: 1000 },
  },
  additionalProperties: false,
};

const callSheetUpdateLineInputSchema = {
  type: 'object',
  required: ['line_id', 'changes'],
  properties: {
    line_id: { type: 'string' },
    changes: callSheetLineInputSchema,
    summary: { type: 'string', maxLength: 500 },
    impact: { type: 'string', maxLength: 1000 },
  },
  additionalProperties: false,
};

const callSheetDeleteLineInputSchema = {
  type: 'object',
  required: ['line_id'],
  properties: {
    line_id: { type: 'string' },
    summary: { type: 'string', maxLength: 500 },
    impact: { type: 'string', maxLength: 1000 },
  },
  additionalProperties: false,
};

const qualityEvidenceInputSchema = {
  type: 'object',
  properties: {
    type: { type: 'string' },
    evidence_type: { type: 'string' },
    status: { type: 'string' },
    evidence_status: { type: 'string' },
    date_from: { type: 'string' },
    date_to: { type: 'string' },
    search: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
  },
  additionalProperties: false,
};

const qualityEventsInputSchema = {
  type: 'object',
  properties: {
    event_type: { type: 'string' },
    source_table: { type: 'string' },
    source_id: { type: 'string' },
    date: { type: 'string' },
    date_from: { type: 'string' },
    date_to: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
  },
  additionalProperties: false,
};

const recallCampaignInputSchema = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    lot: { type: 'string' },
    lot_id: { type: 'string' },
    article: { type: 'string' },
    client: { type: 'string' },
    date: { type: 'string' },
    date_from: { type: 'string' },
    date_to: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
  },
  additionalProperties: false,
};

const traceabilityTestListInputSchema = {
  type: 'object',
  properties: {
    date: { type: 'string' },
    date_from: { type: 'string' },
    date_to: { type: 'string' },
    result: { type: 'string', enum: ['conform', 'non_conform'] },
    lot: { type: 'string' },
    article: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
  },
  additionalProperties: false,
};

function preparedBusinessAction(context, input, defaults) {
  return fullCoverage.prepareBusinessAction(context, input, {
    ...defaults,
    executable_now: true,
    requires_confirmation: true,
  });
}

function preparationTool({ name, title, domain, permission, actionType = name, requiresConfirmation = true, executableNow = false }) {
  return tool({
    name,
    title,
    description: executableNow
      ? `Prepare une action ${domain} executable via confirmation humaine explicite.`
      : `Prepare une action ${domain} controlee sans effet metier direct; aucun service d execution directe n est raccorde pour cette action.`,
    domain,
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: permission,
    requiresConfirmation: false,
    inputSchema: preparationInputSchema,
    execute: async ({ context, input, tool: currentTool }) => response({
      tool: currentTool.name,
      domain: currentTool.domain,
      summary: `Preparation ${title}`,
      data: {
        prepared_action: fullCoverage.prepareBusinessAction(context, input, {
          action_type: actionType,
          required_permissions: executableNow ? ['mcp.execute', permission] : [permission],
          requires_confirmation: requiresConfirmation,
          executable_now: executableNow,
          summary: `Preparation ${title}`,
        }),
      },
      warnings: executableNow ? [] : ['Preparation uniquement: aucune ecriture metier directe n est executee par cet outil.'],
    }),
  });
}

function snapshotTool({ name, title, domain, permission, snapshotKey }) {
  return tool({
    name,
    title,
    description: `Lit un apercu ${domain} via une requete backend allowlistee, sans exposer de secret et sans ecriture.`,
    domain,
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: permission,
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => {
      const snapshot = await fullCoverage.getModuleSnapshot(db, context.store_id, snapshotKey, input);
      return response({
        tool: currentTool.name,
        domain: currentTool.domain,
        summary: snapshot.unavailable ? `${title}: source indisponible` : `${title}: ${snapshot.count} ligne(s)`,
        data: { snapshot },
        warnings: snapshot.unavailable ? [snapshot.error || 'Source indisponible'] : [],
      });
    },
  });
}

function requestedPlanningMode(input = {}) {
  return input.planning_mode || input.task_mode || (input.quality_task_id ? 'existing' : 'none');
}

function planningTaskInput(input = {}, moduleKey) {
  return {
    title: input.task_title || input.title || `Tache ${moduleKey}`,
    module_key: moduleKey,
    zone_id: input.zone_id || input.zone_ids?.[0] || null,
    equipment_id: input.equipment_id || input.equipment_ids?.[0] || null,
    responsible_user_id: input.responsible_user_id || null,
    frequency_value: input.frequency_value || input.expected_frequency_value || null,
    frequency_unit: input.frequency_unit || input.expected_frequency_unit || null,
    target_time: input.target_time || null,
    status: 'pending_review',
    active: false,
    configuration_status: 'pending_review',
    description: input.task_description || `Tache generee depuis la configuration ${moduleKey}.`,
    ...(moduleKey === 'cleaning' ? {
      description: input.task_description || [
        `Tache generee depuis la configuration ${moduleKey}.`,
        input.zone_ids?.length ? `Zones: ${input.zone_ids.join(', ')}` : null,
        input.equipment_ids?.length ? `Equipements: ${input.equipment_ids.join(', ')}` : null,
      ].filter(Boolean).join(' '),
    } : {}),
  };
}

async function resolveQualityPlanningTask(db, context, input = {}, moduleKey) {
  const mode = requestedPlanningMode(input);
  if (mode === 'none') return { quality_task_id: null, created_task: null, planning_mode: mode };
  if (mode === 'new') {
    const result = await qualityConfiguration.createTask(db, context, planningTaskInput(input, moduleKey));
    return { quality_task_id: result.task.id, created_task: result.task, planning_mode: mode };
  }
  return { quality_task_id: input.quality_task_id || null, created_task: null, planning_mode: mode };
}

function qualityId(input = {}, ...names) {
  for (const name of names) {
    if (input[name]) return input[name];
  }
  return null;
}

async function normalizeBusinessActionPayload(db, storeId, actionType, payload = {}) {
  if (!QUALITY_BLOCK_ACTIONS_WITH_CHAPTER.has(actionType)) return payload;
  return {
    ...payload,
    chapter_id: await resolveQualitySectionId(db, storeId, payload),
  };
}

async function qualityOutline(db, storeId, input = {}) {
  const docs = await qualityDocumentation.listDocumentation(db, storeId);
  const collectionId = input.collection_id || docs[0]?.id;
  if (!collectionId) return { collection: null, sections: [] };
  const doc = await qualityDocumentation.getDocumentation(db, storeId, collectionId);
  return {
    collection: doc?.collection || null,
    sections: (doc?.sections || []).filter((section) => !section.archived_at).map((section) => ({
      id: section.id,
      parent_id: section.parent_id,
      code: section.code,
      title: section.title,
      section_type: section.section_type,
      status: section.status,
      version: section.version,
      display_order: section.display_order,
    })),
  };
}

async function draftQualitySectionContent(db, storeId, input = {}) {
  return qualityContext.draftQualitySection(db, storeId, input);
}

async function previewQualitySectionUpdate(db, storeId, input = {}) {
  return qualityContext.previewQualitySectionUpdate(db, storeId, input);
}

function tool(definition) {
  return {
    enabled: true,
    status: 'operational',
    outputSchema: structuredToolOutputSchema,
    ...definition,
  };
}

const tools = [
  tool({
    name: 'list_available_modules',
    title: 'Lister les modules ALTA',
    description: 'Retourne le catalogue maintenu des modules ALTA accessibles a l agent.',
    domain: 'navigation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'agent.use',
    requiresConfirmation: false,
    inputSchema: emptyInputSchema,
    execute: async ({ input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Modules ALTA disponibles', data: { modules: listModules() } }),
  }),
  tool({
    name: 'get_module_capabilities',
    title: 'Capacites d un module',
    description: 'Explique les capacites, permissions et chemin UI d un module ALTA.',
    domain: 'navigation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'agent.use',
    requiresConfirmation: false,
    inputSchema: { type: 'object', required: ['module'], properties: { module: { type: 'string' } }, additionalProperties: false },
    execute: async ({ input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Capacites module ALTA', data: { module: getModule(input.module) } }),
  }),
  tool({
    name: 'get_module_help',
    title: 'Aide module',
    description: 'Donne le chemin et les usages principaux d un module ALTA.',
    domain: 'navigation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'agent.use',
    requiresConfirmation: false,
    inputSchema: { type: 'object', required: ['module'], properties: { module: { type: 'string' } }, additionalProperties: false },
    execute: async ({ input, tool: currentTool }) => {
      const module = getModule(input.module);
      return response({ tool: currentTool.name, domain: currentTool.domain, summary: module ? `${module.title}: ${module.path}` : 'Module introuvable', data: { module } });
    },
  }),
  tool({
    name: 'find_feature_in_alta',
    title: 'Trouver une fonction ALTA',
    description: 'Recherche une fonction dans le catalogue maintenu des modules.',
    domain: 'navigation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'agent.use',
    requiresConfirmation: false,
    inputSchema: searchInputSchema,
    execute: async ({ input, tool: currentTool }) => {
      const query = text(input.query).toLowerCase();
      const results = listModules().filter((item) => [
        item.domain,
        item.module,
        item.title,
        item.description,
        ...(item.capabilities || []),
      ].join(' ').toLowerCase().includes(query));
      return response({ tool: currentTool.name, domain: currentTool.domain, summary: `${results.length} fonction(s) trouvee(s)`, data: { results } });
    },
  }),
  tool({
    name: 'get_user_permissions',
    title: 'Permissions utilisateur',
    description: 'Retourne le contexte permissions de l utilisateur courant sans secret.',
    domain: 'navigation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'agent.use',
    requiresConfirmation: false,
    inputSchema: emptyInputSchema,
    execute: async ({ context, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Permissions utilisateur courant', data: { role: context.role, permissions: context.permissions || [] } }),
  }),
  tool({
    name: 'explain_current_screen',
    title: 'Expliquer l ecran courant',
    description: 'Explique un ecran ALTA a partir du catalogue maintenu.',
    domain: 'navigation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'agent.use',
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, module: { type: 'string' } }, additionalProperties: false },
    execute: async ({ input, tool: currentTool }) => {
      const module = input.module ? getModule(input.module) : listModules().find((item) => item.path === input.path);
      return response({ tool: currentTool.name, domain: currentTool.domain, summary: module ? module.description : 'Ecran non reference dans le catalogue agent', data: { module } });
    },
  }),
  tool({
    name: 'search_clients',
    title: 'Rechercher clients',
    description: 'Recherche les clients du magasin courant.',
    domain: 'clients',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'clients.read',
    requiresConfirmation: false,
    inputSchema: searchInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Recherche clients', data: await commercial.searchClients(db, context.store_id, input) }),
  }),
  tool({
    name: 'search_articles',
    title: 'Rechercher articles',
    description: 'Recherche les articles du magasin courant.',
    domain: 'articles',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'articles.read',
    requiresConfirmation: false,
    inputSchema: searchInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Recherche articles', data: await commercial.searchArticles(db, context.store_id, input) }),
  }),
  tool({
    name: 'search_stock',
    title: 'Rechercher stock',
    description: 'Recherche le stock et les lots du magasin courant. Ne pas utiliser pour établir une prévision globale de trésorerie: utiliser prepare_cashflow_plan.',
    domain: 'stock',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'stock.read',
    requiresConfirmation: false,
    inputSchema: searchInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Recherche stock', data: await commercial.searchStock(db, context.store_id, input) }),
  }),
  tool({
    name: 'search_suppliers',
    title: 'Rechercher fournisseurs',
    description: 'Recherche les fournisseurs du magasin courant. Ne pas utiliser pour établir une prévision globale de trésorerie: utiliser prepare_cashflow_plan.',
    domain: 'suppliers',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'suppliers.read',
    requiresConfirmation: false,
    inputSchema: searchInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Recherche fournisseurs', data: await commercial.searchSuppliers(db, context.store_id, input) }),
  }),
  tool({
    name: 'search_sales',
    title: 'Rechercher ventes',
    description: 'Recherche commandes, BL, factures et lignes de vente. Ne pas utiliser pour établir une prévision globale de trésorerie: utiliser prepare_cashflow_plan.',
    domain: 'sales',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'sales.read',
    requiresConfirmation: false,
    inputSchema: searchInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Recherche ventes', data: await commercial.searchSales(db, context.store_id, input) }),
  }),
  tool({
    name: 'get_client_profile',
    title: 'Profil client',
    description: 'Lit une fiche client via la recherche commerciale existante, avec contacts/tarifs/historique disponibles dans la reponse.',
    domain: 'clients',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'clients.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 20 } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Profil client', data: await commercial.searchClients(db, context.store_id, { query: input.query || input.id, limit: input.limit || 5 }) }),
  }),
  tool({
    name: 'get_supplier_profile',
    title: 'Profil fournisseur',
    description: 'Lit une fiche fournisseur via la recherche fournisseur existante.',
    domain: 'suppliers',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'suppliers.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 20 } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Profil fournisseur', data: await commercial.searchSuppliers(db, context.store_id, { query: input.query || input.id, limit: input.limit || 5 }) }),
  }),
  tool({
    name: 'get_article_profile',
    title: 'Profil article',
    description: 'Lit une fiche article via la recherche articles existante.',
    domain: 'articles',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'articles.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 20 } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Profil article', data: await commercial.searchArticles(db, context.store_id, { query: input.query || input.id, limit: input.limit || 5 }) }),
  }),
  tool({
    name: 'get_sale_profile',
    title: 'Profil vente',
    description: 'Lit une vente ou commande via la recherche ventes existante.',
    domain: 'sales',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'sales.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 20 } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Profil vente', data: await commercial.searchSales(db, context.store_id, { query: input.query || input.id, limit: input.limit || 5 }) }),
  }),
  snapshotTool({ name: 'get_purchases_overview', title: 'Apercu achats', domain: 'purchases', permission: 'purchases.read', snapshotKey: 'purchases' }),
  snapshotTool({ name: 'get_purchase_profile', title: 'Profil achat', domain: 'purchases', permission: 'purchases.read', snapshotKey: 'purchases' }),
  snapshotTool({ name: 'get_communications_overview', title: 'Apercu communications', domain: 'communications', permission: 'communications.read', snapshotKey: 'communications' }),
  tool({
    name: 'list_call_sheets',
    title: "Lister fiches d'appel",
    description: "Liste les fiches d'appel / mercuriales du magasin courant, avec fournisseur et nombre de lignes.",
    domain: 'call_sheet',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'call_sheet.read',
    requiresConfirmation: false,
    inputSchema: callSheetReadInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: "Fiches d'appel", data: await callSheet.listCallSheets(db, context.store_id, input) }),
  }),
  tool({
    name: 'get_call_sheet',
    title: "Lire fiche d'appel",
    description: "Lit une fiche d'appel / mercuriale et ses lignes par id ou date.",
    domain: 'call_sheet',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'call_sheet.read',
    requiresConfirmation: false,
    inputSchema: callSheetReadInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: "Detail fiche d'appel", data: await callSheet.getCallSheet(db, context.store_id, input) }),
  }),
  tool({
    name: 'search_call_sheet_lines',
    title: "Rechercher lignes fiche d'appel",
    description: "Recherche les lignes produit d'une fiche d'appel / mercuriale.",
    domain: 'call_sheet',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'call_sheet.read',
    requiresConfirmation: false,
    inputSchema: callSheetReadInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: "Lignes fiche d'appel", data: await callSheet.searchCallSheetLines(db, context.store_id, input) }),
  }),
  snapshotTool({ name: 'get_pennylane_sync_status', title: 'Etat synchronisation Pennylane', domain: 'pennylane', permission: 'pennylane.read', snapshotKey: 'pennylane' }),
  snapshotTool({ name: 'get_pennylane_diagnostics', title: 'Diagnostics Pennylane', domain: 'pennylane', permission: 'pennylane.read', snapshotKey: 'pennylane' }),
  snapshotTool({ name: 'get_employee_planning', title: 'Planning salarie', domain: 'employee_planning', permission: 'employee_planning.read', snapshotKey: 'employee_planning' }),
  snapshotTool({ name: 'get_employee_profile', title: 'Profil salarie', domain: 'employee_planning', permission: 'employee_planning.read', snapshotKey: 'employee_planning' }),
  snapshotTool({ name: 'get_transformations', title: 'Transformations', domain: 'transformations', permission: 'transformations.read', snapshotKey: 'transformations' }),
  snapshotTool({ name: 'get_transformation_profile', title: 'Profil transformation', domain: 'transformations', permission: 'transformations.read', snapshotKey: 'transformations' }),
  snapshotTool({ name: 'get_stock_lots', title: 'Lots stock', domain: 'stock', permission: 'stock.read', snapshotKey: 'stock_lots' }),
  snapshotTool({ name: 'get_stock_movements', title: 'Mouvements stock', domain: 'stock', permission: 'stock.read', snapshotKey: 'stock_movements' }),
  tool({
    name: 'list_quality_evidence_records',
    title: 'Lister enregistrements qualite',
    description: 'Liste les preuves/enregistrements qualite existants sans inventer de controles. Couvre reception_record, traceability_test_record, product_recall_record, product_recall_notification_record et futurs types generiques.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.read',
    requiresConfirmation: false,
    inputSchema: qualityEvidenceInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Enregistrements qualite', data: { records: await agentQualityRecall.listQualityEvidenceRecords(db, context.store_id, input) } }),
  }),
  tool({
    name: 'get_quality_evidence_record',
    title: 'Detail enregistrement qualite',
    description: 'Relit un enregistrement qualite par id avec son payload metier complet, en lecture seule.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.read',
    requiresConfirmation: false,
    inputSchema: idInputSchema('id'),
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Detail enregistrement qualite', data: { record: await agentQualityRecall.getQualityEvidenceRecord(db, context.store_id, input) } }),
  }),
  tool({
    name: 'list_quality_events',
    title: 'Lister evenements qualite',
    description: 'Liste les evenements qualite existants comme purchase_received, traceability_test_completed, product_recall_initiated ou product_recall_notifications_processed.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.read',
    requiresConfirmation: false,
    inputSchema: qualityEventsInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Evenements qualite', data: { events: await agentQualityRecall.listQualityEvents(db, context.store_id, input) } }),
  }),
  tool({
    name: 'get_quality_event',
    title: 'Detail evenement qualite',
    description: 'Relit un evenement qualite par id en respectant le magasin courant.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.read',
    requiresConfirmation: false,
    inputSchema: idInputSchema('id'),
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Detail evenement qualite', data: { event: await agentQualityRecall.getQualityEvent(db, context.store_id, input) } }),
  }),
  tool({
    name: 'list_quality_blocked_lots',
    title: 'Lister lots bloques qualite',
    description: 'Liste les lots actuellement bloques qualite avec article, PLU, lot fournisseur, stock restant, motif, date de blocage et non-conformite liee si presente.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.read',
    requiresConfirmation: false,
    inputSchema: searchInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Lots bloques qualite', data: { lots: await agentQualityRecall.listQualityBlockedLots(db, context.store_id, input) } }),
  }),
  tool({
    name: 'get_lot_quality_status',
    title: 'Statut qualite lot',
    description: 'Retourne le statut qualite courant d un lot et son historique blocage/liberation.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', required: ['lot_id'], properties: { lot_id: { type: 'string' } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Statut qualite lot', data: await agentQualityRecall.getLotQualityStatus(db, context.store_id, input) }),
  }),
  tool({
    name: 'search_traceability_lots',
    title: 'Rechercher lots tracabilite',
    description: 'Recherche un lot ALTA, lot fournisseur, PLU ou designation avant reconstruction de tracabilite.',
    domain: 'stock',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'stock.read',
    requiresConfirmation: false,
    inputSchema: searchInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Lots tracabilite', data: { lots: await agentQualityRecall.searchTraceabilityLots(db, context.store_id, input) } }),
  }),
  tool({
    name: 'get_traceability_snapshot',
    title: 'Snapshot tracabilite lot',
    description: 'Reconstruit la tracabilite amont/aval reelle d un lot a partir des achats, lots, transformations, allocations de vente et clients livres.',
    domain: 'stock',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'stock.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', required: ['lot_id'], properties: { lot_id: { type: 'string' } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Snapshot tracabilite', data: await agentQualityRecall.getTraceabilitySnapshot(db, context.store_id, input) }),
  }),
  tool({
    name: 'list_traceability_tests',
    title: 'Lister tests tracabilite',
    description: 'Liste les tests de tracabilite enregistres depuis les evidence records traceability_test_record, avec filtres date, resultat, lot et article.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.read',
    requiresConfirmation: false,
    inputSchema: traceabilityTestListInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Tests tracabilite', data: { tests: await agentQualityRecall.listTraceabilityTests(db, context.store_id, input) } }),
  }),
  tool({
    name: 'get_traceability_test',
    title: 'Detail test tracabilite',
    description: 'Relit un traceability_test_record et son snapshot complet.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.read',
    requiresConfirmation: false,
    inputSchema: idInputSchema('id'),
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Detail test tracabilite', data: { test: await agentQualityRecall.getTraceabilityTest(db, context.store_id, input) } }),
  }),
  tool({
    name: 'list_product_recall_campaigns',
    title: 'Lister rappels produit',
    description: 'Liste les campagnes de retrait/rappel produit avec statuts, lot, article et synthese destinataires.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.read',
    requiresConfirmation: false,
    inputSchema: recallCampaignInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Campagnes rappel produit', data: { campaigns: await agentQualityRecall.listProductRecallCampaigns(db, context.store_id, input) } }),
  }),
  tool({
    name: 'get_product_recall_campaign',
    title: 'Detail rappel produit',
    description: 'Retourne une campagne de rappel produit avec lot, article, destinataires, BL, quantites, emails et statuts envoi.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', required: ['campaign_id'], properties: { campaign_id: { type: 'string' } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Detail rappel produit', data: await agentQualityRecall.getProductRecallCampaign(db, context.store_id, input) }),
  }),
  tool({
    name: 'analyze_product_recall_for_lot',
    title: 'Analyser rappel pour lot',
    description: 'Analyse les clients reellement livres ayant recu un lot avant preparation d un rappel produit. Ne cree aucune campagne et n envoie aucun email.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', required: ['lot_id'], properties: { lot_id: { type: 'string' } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Analyse rappel lot', data: await agentQualityRecall.analyzeProductRecallForLot(db, context.store_id, input) }),
  }),
  tool({
    name: 'prepare_quality_lot_block',
    title: 'Preparer blocage lot qualite',
    description: 'Prepare un blocage qualite de lot. Aucun blocage n est execute: creer ensuite une pending action quality.lot.block puis execute_pending_action apres confirmation humaine.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'stock.write',
    requiredPermissions: ['quality.record.create', 'stock.write'],
    requiresConfirmation: false,
    inputSchema: { type: 'object', required: ['lot_id', 'reason_type', 'reason'], properties: { lot_id: { type: 'string' }, reason_type: { type: 'string' }, reason: { type: 'string' }, comment: { type: 'string' }, quality_non_conformity_id: { type: 'string' } }, additionalProperties: false },
    execute: async ({ context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Blocage lot prepare', data: { prepared_action: preparedBusinessAction(context, { payload: input, summary: input.summary }, { action_type: 'quality.lot.block', required_permissions: ['mcp.execute', 'quality.record.create', 'stock.write'], summary: 'Bloquer le lot pour raison qualite', impact: 'Le lot sera bloque et historise apres confirmation humaine.' }) } }),
  }),
  tool({
    name: 'prepare_quality_lot_release',
    title: 'Preparer liberation lot qualite',
    description: 'Prepare une liberation de lot bloque. Aucune liberation silencieuse: execution seulement via pending action quality.lot.release avec confirmation humaine explicite.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'stock.write',
    requiredPermissions: ['quality.record.create', 'stock.write'],
    requiresConfirmation: false,
    inputSchema: { type: 'object', required: ['lot_id', 'reason', 'comment'], properties: { lot_id: { type: 'string' }, reason: { type: 'string' }, comment: { type: 'string' } }, additionalProperties: false },
    execute: async ({ context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Liberation lot preparee', data: { prepared_action: preparedBusinessAction(context, { payload: input, summary: input.summary }, { action_type: 'quality.lot.release', required_permissions: ['mcp.execute', 'quality.record.create', 'stock.write'], summary: 'Liberer le lot bloque qualite', impact: 'Le lot sera libere et historise apres confirmation humaine.' }) } }),
  }),
  tool({
    name: 'prepare_traceability_test_completion',
    title: 'Preparer validation test tracabilite',
    description: 'Prepare la validation humaine d un test de tracabilite avec confirmation humaine explicite. GPT peut resumer les liens mais ne doit jamais decider conforme automatiquement.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'quality.record.create',
    requiresConfirmation: false,
    inputSchema: { type: 'object', required: ['lot_id', 'result'], properties: { lot_id: { type: 'string' }, result: { type: 'string', enum: ['conform', 'non_conform'] }, observation: { type: 'string' }, corrective_action: { type: 'string' }, started_at: { type: 'string' } }, additionalProperties: false },
    execute: async ({ context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Validation test tracabilite preparee', data: { prepared_action: preparedBusinessAction(context, { payload: input, summary: input.summary }, { action_type: 'quality.traceability_test.complete', required_permissions: ['mcp.execute', 'quality.record.create'], summary: 'Valider le test de tracabilite', impact: 'Un evenement et un enregistrement qualite seront crees apres decision humaine.' }) } }),
  }),
  tool({
    name: 'prepare_product_recall',
    title: 'Preparer rappel produit',
    description: 'Prepare une campagne de retrait/rappel produit apres analyse d impact. Ne cree pas la campagne et n envoie jamais d email sans confirmation humaine.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'quality.record.create',
    requiresConfirmation: false,
    inputSchema: { type: 'object', required: ['lot_id', 'recall_type', 'reason'], properties: { lot_id: { type: 'string' }, recall_type: { type: 'string' }, reason: { type: 'string' }, comment: { type: 'string' } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Rappel produit prepare', data: { analysis: await agentQualityRecall.analyzeProductRecallForLot(db, context.store_id, input), prepared_action: preparedBusinessAction(context, { payload: input, summary: input.summary }, { action_type: 'product_recall.create_campaign', required_permissions: ['mcp.execute', 'quality.record.create', 'stock.write'], summary: 'Creer la campagne de rappel produit', impact: 'La campagne sera creee, le lot bloque si necessaire, et aucun email ne sera envoye.' }) } }),
  }),
  tool({
    name: 'prepare_product_recall_notifications',
    title: 'Preparer emails rappel produit',
    description: 'Prepare l envoi des emails de rappel: montre destinataires, emails, sujet et apercu. Aucun email n est envoye sans confirmation humaine finale.',
    domain: 'communications',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'communications.send',
    requiredPermissions: ['communications.send', 'quality.record.create'],
    requiresConfirmation: false,
    inputSchema: { type: 'object', required: ['campaign_id', 'recipient_ids'], properties: { campaign_id: { type: 'string' }, recipient_ids: { type: 'array', minItems: 1, items: { type: 'string' } } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Emails rappel prepares', data: { preview: await agentQualityRecall.prepareRecallNotifications(db, context.store_id, input), prepared_action: preparedBusinessAction(context, { payload: input, summary: input.summary }, { action_type: 'product_recall.send_notifications', required_permissions: ['mcp.execute', 'communications.send', 'quality.record.create'], summary: 'Envoyer les emails de rappel produit', impact: 'Les emails selectionnes seront envoyes apres confirmation humaine finale.' }) } }),
  }),
  preparationTool({ name: 'prepare_client_draft', title: 'brouillon client', domain: 'clients', permission: 'clients.write' }),
  preparationTool({ name: 'prepare_client_update', title: 'modification client', domain: 'clients', permission: 'clients.write' }),
  preparationTool({ name: 'prepare_customer_price_list', title: 'liste tarifaire client', domain: 'clients', permission: 'clients.write' }),
  preparationTool({ name: 'prepare_supplier_draft', title: 'brouillon fournisseur', domain: 'suppliers', permission: 'suppliers.write' }),
  preparationTool({ name: 'prepare_supplier_update', title: 'modification fournisseur', domain: 'suppliers', permission: 'suppliers.write' }),
  preparationTool({ name: 'prepare_supplier_article_mapping', title: 'mapping article fournisseur', domain: 'suppliers', permission: 'suppliers.write' }),
  preparationTool({ name: 'prepare_supplier_order', title: 'commande fournisseur', domain: 'suppliers', permission: 'suppliers.write' }),
  tool({
    name: 'prepare_article_create',
    title: 'Preparer creation Article',
    description: 'Prepare la creation controlee d un Article via l action canonique articles.create. Rechercher un Article existant avant de preparer pour eviter un doublon evident.',
    domain: 'articles',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'articles.write',
    requiredPermissions: ['articles.write'],
    requiresConfirmation: false,
    inputSchema: articleCreateInputSchema,
    execute: async ({ context, input, tool: currentTool }) => {
      const unknownKeys = Object.keys(input || {}).filter((key) => !articleCreatePrepareInputFields.has(key));
      if (unknownKeys.length) {
        const error = new Error(`Cle(s) non autorisee(s) pour prepare_article_create : ${unknownKeys.join(', ')}`);
        error.status = 400;
        error.expose = true;
        throw error;
      }
      const payload = normalizeAgentArticleCreatePayload(input);
      const summary = input.summary || `Creer l article ${payload.designation}`;
      const prepared = preparedBusinessAction(context, {
        payload,
        summary,
        impact: input.impact || 'Un nouvel Article sera cree dans le referentiel Articles du magasin courant apres confirmation humaine.',
        target_objects: input.target_objects || [{ type: 'article', designation: payload.designation, plu: payload.plu }],
      }, {
        action_type: 'articles.create',
        required_permissions: ['mcp.execute', 'articles.write'],
        summary,
        impact: input.impact || 'Un nouvel Article sera cree dans le referentiel Articles du magasin courant apres confirmation humaine.',
      });
      return response({
        tool: currentTool.name,
        domain: currentTool.domain,
        summary: 'Creation Article preparee',
        data: {
          prepared_action: prepared,
          confirmation_tool: 'create_pending_action',
          action_type: 'articles.create',
          payload,
        },
      });
    },
  }),
  preparationTool({ name: 'prepare_article_draft', title: 'brouillon article', domain: 'articles', permission: 'articles.write' }),
  tool({
    name: 'prepare_article_update',
    title: 'Preparer conditions conservation Article',
    description: 'Prepare uniquement une modification allowlistee des champs storage_temperature_min, storage_temperature_max et storage_instruction. Creer ensuite une pending action articles.update_storage_conditions puis execute_pending_action apres confirmation humaine.',
    domain: 'articles',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'articles.write',
    requiredPermissions: ['articles.write'],
    requiresConfirmation: false,
    inputSchema: articleStorageUpdateInputSchema,
    execute: async ({ context, input, tool: currentTool }) => {
      const unknownKeys = Object.keys(input || {}).filter((key) => !articleStoragePrepareInputFields.has(key));
      if (unknownKeys.length) {
        const error = new Error(`Cle(s) non autorisee(s) pour prepare_article_update : ${unknownKeys.join(', ')}`);
        error.status = 400;
        error.expose = true;
        throw error;
      }
      const payload = normalizeArticleStorageUpdatePayload({
        article_id: input.article_id,
        changes: input.changes,
      });
      const prepared = preparedBusinessAction(context, {
        payload,
        summary: input.summary || 'Modifier les conditions de conservation Article',
        impact: input.impact || 'Seuls les champs de conservation Article seront modifies apres confirmation humaine.',
        target_objects: input.target_objects || [{ type: 'article', id: payload.article_id }],
      }, {
        action_type: 'articles.update_storage_conditions',
        required_permissions: ['mcp.execute', 'articles.write'],
        summary: input.summary || 'Modifier les conditions de conservation Article',
        impact: input.impact || 'Seuls les champs de conservation Article seront modifies apres confirmation humaine.',
      });
      return response({
        tool: currentTool.name,
        domain: currentTool.domain,
        summary: 'Modification Article preparee',
        data: {
          prepared_action: prepared,
          confirmation_tool: 'create_pending_action',
          action_type: 'articles.update_storage_conditions',
          payload,
        },
      });
    },
  }),
  preparationTool({ name: 'prepare_article_price_update', title: 'modification prix article', domain: 'articles', permission: 'articles.write' }),
  preparationTool({ name: 'prepare_lot_update', title: 'modification lot non historique', domain: 'stock', permission: 'stock.write' }),
  preparationTool({ name: 'prepare_stock_regularization', title: 'regularisation stock', domain: 'stock', permission: 'stock.write', requiresConfirmation: true }),
  preparationTool({ name: 'prepare_traceability_action', title: 'action tracabilite', domain: 'stock', permission: 'stock.write' }),
  preparationTool({ name: 'prepare_purchase', title: 'achat fournisseur', domain: 'purchases', permission: 'purchases.write' }),
  preparationTool({ name: 'prepare_purchase_update', title: 'modification achat', domain: 'purchases', permission: 'purchases.write' }),
  preparationTool({ name: 'prepare_purchase_reception', title: 'reception achat', domain: 'purchases', permission: 'purchases.write', requiresConfirmation: true }),
  preparationTool({ name: 'prepare_supplier_invoice_matching', title: 'rapprochement facture fournisseur', domain: 'purchases', permission: 'purchases.write', requiresConfirmation: true }),
  preparationTool({ name: 'prepare_customer_order', title: 'commande client', domain: 'sales', permission: 'sales.write', executableNow: true, actionType: 'sales.create_customer_order' }),
  preparationTool({ name: 'prepare_sales_document_update', title: 'modification document vente', domain: 'sales', permission: 'sales.write' }),
  preparationTool({ name: 'prepare_delivery_note', title: 'bon de livraison', domain: 'sales', permission: 'sales.write', executableNow: true, actionType: 'sales.convert_order_to_delivery_note' }),
  preparationTool({ name: 'prepare_customer_invoice', title: 'facture client', domain: 'sales', permission: 'sales.write', requiresConfirmation: true }),
  preparationTool({ name: 'prepare_customer_credit_note', title: 'avoir client', domain: 'sales', permission: 'sales.write', requiresConfirmation: true }),
  tool({
    name: 'prepare_call_sheet_add_line',
    title: "Preparer ajout ligne fiche d'appel",
    description: "Prepare l'ajout d'une ligne sur une fiche d'appel existante. Aucun tarif n'est calcule automatiquement.",
    domain: 'call_sheet',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'call_sheet.write',
    requiresConfirmation: false,
    inputSchema: callSheetAddLineInputSchema,
    execute: async ({ context, input, tool: currentTool }) => {
      const payload = callSheet.normalizeAddLinePayload({ sheet_id: input.sheet_id, line: input.line });
      return response({
        tool: currentTool.name,
        domain: currentTool.domain,
        summary: "Ajout ligne fiche d'appel prepare",
        data: {
          prepared_action: preparedBusinessAction(context, {
            payload,
            summary: input.summary || "Ajouter une ligne fiche d'appel",
            impact: input.impact || "Une ligne produit sera ajoutee apres confirmation humaine.",
            target_objects: [{ type: 'quick_order_sheet', id: payload.sheet_id }],
          }, {
            action_type: 'call_sheet.add_line',
            required_permissions: ['mcp.execute', 'call_sheet.write'],
            summary: input.summary || "Ajouter une ligne fiche d'appel",
            impact: input.impact || "Une ligne produit sera ajoutee apres confirmation humaine.",
          }),
          confirmation_tool: 'create_pending_action',
          action_type: 'call_sheet.add_line',
          payload,
        },
      });
    },
  }),
  tool({
    name: 'prepare_call_sheet_update_line',
    title: "Preparer modification ligne fiche d'appel",
    description: "Prepare une modification PATCH-like d'une ligne fiche d'appel. Les tarifs 1/2/3 ne changent que si fournis explicitement.",
    domain: 'call_sheet',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'call_sheet.write',
    requiresConfirmation: false,
    inputSchema: callSheetUpdateLineInputSchema,
    execute: async ({ context, input, tool: currentTool }) => {
      const payload = callSheet.normalizeUpdateLinePayload({ line_id: input.line_id, changes: input.changes });
      return response({
        tool: currentTool.name,
        domain: currentTool.domain,
        summary: "Modification ligne fiche d'appel preparee",
        data: {
          prepared_action: preparedBusinessAction(context, {
            payload,
            summary: input.summary || "Modifier une ligne fiche d'appel",
            impact: input.impact || "Seuls les champs fournis seront modifies apres confirmation humaine.",
            target_objects: [{ type: 'quick_order_sheet_product', id: payload.line_id }],
          }, {
            action_type: 'call_sheet.update_line',
            required_permissions: ['mcp.execute', 'call_sheet.write'],
            summary: input.summary || "Modifier une ligne fiche d'appel",
            impact: input.impact || "Seuls les champs fournis seront modifies apres confirmation humaine.",
          }),
          confirmation_tool: 'create_pending_action',
          action_type: 'call_sheet.update_line',
          payload,
        },
      });
    },
  }),
  tool({
    name: 'prepare_call_sheet_delete_line',
    title: "Preparer suppression ligne fiche d'appel",
    description: "Prepare la suppression d'une ligne fiche d'appel. L'execution exige create_pending_action puis confirmation humaine.",
    domain: 'call_sheet',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'call_sheet.write',
    requiresConfirmation: false,
    inputSchema: callSheetDeleteLineInputSchema,
    execute: async ({ context, input, tool: currentTool }) => {
      const payload = callSheet.normalizeDeleteLinePayload({ line_id: input.line_id });
      return response({
        tool: currentTool.name,
        domain: currentTool.domain,
        summary: "Suppression ligne fiche d'appel preparee",
        data: {
          prepared_action: preparedBusinessAction(context, {
            payload,
            summary: input.summary || "Supprimer une ligne fiche d'appel",
            impact: input.impact || "La ligne sera supprimee apres confirmation humaine explicite.",
            target_objects: [{ type: 'quick_order_sheet_product', id: payload.line_id }],
          }, {
            action_type: 'call_sheet.delete_line',
            required_permissions: ['mcp.execute', 'call_sheet.write'],
            summary: input.summary || "Supprimer une ligne fiche d'appel",
            impact: input.impact || "La ligne sera supprimee apres confirmation humaine explicite.",
          }),
          confirmation_tool: 'create_pending_action',
          action_type: 'call_sheet.delete_line',
          payload,
        },
      });
    },
  }),
  preparationTool({ name: 'prepare_email_draft', title: 'brouillon email', domain: 'communications', permission: 'communications.read', requiresConfirmation: false }),
  preparationTool({ name: 'prepare_whatsapp_message', title: 'message WhatsApp', domain: 'communications', permission: 'communications.read', requiresConfirmation: false }),
  preparationTool({ name: 'prepare_sms_message', title: 'message SMS', domain: 'communications', permission: 'communications.read', requiresConfirmation: false }),
  preparationTool({ name: 'preview_email', title: 'apercu email', domain: 'communications', permission: 'communications.read', requiresConfirmation: false }),
  preparationTool({ name: 'preview_customer_price_list', title: 'apercu mercuriale', domain: 'communications', permission: 'communications.read', requiresConfirmation: false }),
  preparationTool({ name: 'send_email_confirmed', title: 'envoi email confirme', domain: 'communications', permission: 'communications.send', requiresConfirmation: true }),
  preparationTool({ name: 'send_customer_price_list_confirmed', title: 'envoi mercuriale confirme', domain: 'communications', permission: 'communications.send', requiresConfirmation: true }),
  preparationTool({ name: 'analyze_business_performance', title: 'analyse performance', domain: 'statistics', permission: 'statistics.read', requiresConfirmation: false }),
  preparationTool({ name: 'prepare_cashflow_manual_item', title: 'element manuel tresorerie', domain: 'cashflow', permission: 'cashflow.write' }),
  preparationTool({ name: 'prepare_cashflow_settings_update', title: 'parametres tresorerie', domain: 'cashflow', permission: 'cashflow.write' }),
  preparationTool({ name: 'prepare_pennylane_sync', title: 'synchronisation Pennylane', domain: 'pennylane', permission: 'pennylane.sync', requiresConfirmation: true }),
  preparationTool({ name: 'prepare_pennylane_mapping_update', title: 'mapping Pennylane', domain: 'pennylane', permission: 'pennylane.sync' }),
  preparationTool({ name: 'prepare_employee_draft', title: 'brouillon salarie', domain: 'employee_planning', permission: 'employee_planning.write' }),
  preparationTool({ name: 'prepare_employee_absence', title: 'absence salarie', domain: 'employee_planning', permission: 'employee_planning.write' }),
  preparationTool({ name: 'prepare_employee_planning_update', title: 'modification planning', domain: 'employee_planning', permission: 'employee_planning.write' }),
  preparationTool({ name: 'prepare_employee_manager_validation', title: 'validation responsable planning', domain: 'employee_planning', permission: 'employee_planning.write', requiresConfirmation: true }),
  preparationTool({ name: 'prepare_transformation', title: 'transformation negoce', domain: 'transformations', permission: 'transformations.write' }),
  preparationTool({ name: 'prepare_transformation_update', title: 'modification transformation', domain: 'transformations', permission: 'transformations.write' }),
  preparationTool({ name: 'prepare_transformation_validation', title: 'validation transformation', domain: 'transformations', permission: 'transformations.write', requiresConfirmation: true }),
  tool({
    name: 'create_pending_action',
    title: 'Creer une action en attente',
    description: 'Fige un payload allowliste et demande une confirmation humaine avant execution metier reelle. Utiliser list_executable_actions pour connaitre les action_type exacts. Pour appliquer des modifications de documentation qualite, action_type doit etre quality.documentation.apply_section_updates.',
    domain: 'agent_actions',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'agent.use',
    requiresConfirmation: false,
    inputSchema: { type: 'object', required: ['action_type', 'summary', 'payload'], properties: { action_type: { type: 'string' }, summary: { type: 'string' }, payload: { type: 'object' } }, additionalProperties: true },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Action en attente creee', data: await createExecutablePendingAction({ db, context, input }) }),
  }),
  tool({
    name: 'list_executable_actions',
    title: 'Lister actions executables',
    description: 'Retourne la allowlist des actions metier que le MCP peut executer apres confirmation.',
    domain: 'agent_actions',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'agent.use',
    requiresConfirmation: false,
    inputSchema: emptyInputSchema,
    execute: async ({ tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Actions MCP executables', data: { actions: listExecutableActions() } }),
  }),
  tool({
    name: 'execute_pending_action',
    title: 'Executer une action confirmee',
    description: 'Execute exactement le payload fige d une action en attente allowlistee. Exige confirmation humaine, mcp.execute et la permission metier.',
    domain: 'agent_actions',
    riskLevel: RISK_LEVELS.COMMITTING_ACTION,
    requiredPermission: 'mcp.execute',
    requiresConfirmation: true,
    inputSchema: { type: 'object', required: ['id', 'confirmation'], properties: { id: { type: 'string' }, confirmation: { type: 'string', enum: ['human_confirmed'] } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Action en attente executee', data: await executeExecutablePendingAction({ dbPool: db, context, input }) }),
  }),
  tool({
    name: 'execute_business_action',
    title: 'Executer action metier',
    description: 'Execute directement une action metier allowlistee. En trusted mode, ne requiert ni pending action ni confirmation. Utiliser list_executable_actions pour choisir action_type et payload.',
    domain: 'agent_actions',
    riskLevel: RISK_LEVELS.COMMITTING_ACTION,
    requiredPermission: 'mcp.execute',
    requiresConfirmation: true,
    inputSchema: { type: 'object', required: ['action_type', 'payload'], properties: { action_type: { type: 'string' }, payload: { type: 'object' } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => response({
      tool: currentTool.name,
      domain: currentTool.domain,
      summary: 'Action metier executee',
      data: await executeExecutableActionDirect({
        dbPool: db,
        context,
        actionType: input.action_type,
        payload: await normalizeBusinessActionPayload(db, context.store_id, input.action_type, input.payload || {}),
      }),
    }),
  }),
  tool({
    name: 'quality.documentation.apply_section_updates',
    title: 'Appliquer chapitres qualite',
    description: 'Applique directement un paquet de mises a jour de chapitres qualite via qualityDocumentationService.updateSection. En trusted mode, aucun pending_action ni confirmation n est requis.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.COMMITTING_ACTION,
    requiredPermission: 'quality.documentation.edit',
    requiresConfirmation: true,
    inputSchema: {
      type: 'object',
      required: ['updates'],
      properties: {
        collection_id: { type: 'string' },
        mode: { type: 'string', enum: ['all_or_nothing'] },
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
    execute: async ({ db, context, input, tool: currentTool }) => response({
      tool: currentTool.name,
      domain: currentTool.domain,
      summary: 'Chapitres qualite mis a jour',
      data: await executeExecutableActionDirect({
        dbPool: db,
        context,
        actionType: 'quality.documentation.apply_section_updates',
        payload: input,
      }),
    }),
  }),
  tool({
    name: 'get_cashflow_dashboard',
    title: 'Tableau de bord tresorerie',
    description: 'Lit le tableau de bord de tresorerie calcule par le backend.',
    domain: 'cashflow',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'cashflow.read',
    requiresConfirmation: false,
    inputSchema: periodInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Tableau de bord tresorerie', data: await cashflow.getDashboard(db, context.store_id, input) }),
  }),
  tool({
    name: 'get_cashflow_forecast',
    title: 'Prevision tresorerie',
    description: 'Calcule une prevision de tresorerie par le backend.',
    domain: 'cashflow',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'cashflow.read',
    requiresConfirmation: false,
    inputSchema: periodInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: `Prevision tresorerie ${input.days || 30} jours`, data: await cashflow.getForecast(db, context.store_id, input) }),
  }),
  tool({
    name: 'get_cashflow_data_sources',
    title: 'Sources tresorerie',
    description: 'Retourne les sources et fraicheurs exploitees par la tresorerie.',
    domain: 'cashflow',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'cashflow.read',
    requiresConfirmation: false,
    inputSchema: emptyInputSchema,
    execute: async ({ db, context, tool: currentTool }) => {
      const data = await cashflow.getCashflowDataSources(db, context.store_id);
      return response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Sources tresorerie ALTA', data, source_freshness: data });
    },
  }),
  tool({
    name: 'get_customer_receivables',
    title: 'Creances clients',
    description: 'Liste les factures clients non payees prises en compte en tresorerie.',
    domain: 'cashflow',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'cashflow.read',
    requiresConfirmation: false,
    inputSchema: emptyInputSchema,
    execute: async ({ db, context, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Creances clients', data: { receivables: await cashflow.listCustomerReceivables(db, context.store_id) } }),
  }),
  tool({
    name: 'get_customer_payment_schedule',
    title: 'Echeancier encaissements clients',
    description: 'Construit l echeancier des encaissements clients prevus depuis les factures ouvertes.',
    domain: 'cashflow',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'cashflow.read',
    requiresConfirmation: false,
    inputSchema: periodInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => {
      const projection = await cashflow.buildCashflowProjection(db, context.store_id, input);
      return response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Echeancier encaissements clients', data: { schedule: projection.expected_customer_receipts }, source_freshness: projection.source_freshness });
    },
  }),
  tool({
    name: 'get_supplier_payables',
    title: 'Dettes fournisseurs',
    description: 'Liste les factures fournisseurs ouvertes prises en compte en tresorerie.',
    domain: 'cashflow',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'cashflow.read',
    requiresConfirmation: false,
    inputSchema: emptyInputSchema,
    execute: async ({ db, context, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Dettes fournisseurs', data: { payables: await cashflow.listSupplierPayables(db, context.store_id) } }),
  }),
  tool({
    name: 'get_supplier_exposure',
    title: 'Encours fournisseurs',
    description: 'Calcule les encours fournisseurs depuis les factures ouvertes.',
    domain: 'cashflow',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'cashflow.read',
    requiresConfirmation: false,
    inputSchema: emptyInputSchema,
    execute: async ({ db, context, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Encours fournisseurs', data: { suppliers: await cashflow.supplierExposure(db, context.store_id) } }),
  }),
  tool({
    name: 'get_supplier_payment_schedule',
    title: 'Echeancier paiements fournisseurs',
    description: 'Construit l echeancier des paiements fournisseurs prevus depuis Pennylane et ALTA.',
    domain: 'cashflow',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'cashflow.read',
    requiresConfirmation: false,
    inputSchema: periodInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => {
      const projection = await cashflow.buildCashflowProjection(db, context.store_id, input);
      return response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Echeancier paiements fournisseurs', data: { schedule: projection.expected_supplier_payments }, source_freshness: projection.source_freshness });
    },
  }),
  tool({
    name: 'get_bank_accounts_summary',
    title: 'Comptes bancaires',
    description: 'Liste les comptes bancaires utilises par le previsionnel.',
    domain: 'cashflow',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'cashflow.read',
    requiresConfirmation: false,
    inputSchema: emptyInputSchema,
    execute: async ({ db, context, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Comptes bancaires', data: { accounts: await cashflow.listBankAccounts(db, context.store_id) } }),
  }),
  tool({
    name: 'get_bank_balances',
    title: 'Soldes bancaires',
    description: 'Retourne les soldes bancaires connus et inclus dans la tresorerie.',
    domain: 'cashflow',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'cashflow.read',
    requiresConfirmation: false,
    inputSchema: emptyInputSchema,
    execute: async ({ db, context, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Soldes bancaires', data: { accounts: await cashflow.listBankAccounts(db, context.store_id) } }),
  }),
  tool({
    name: 'get_bank_transactions',
    title: 'Transactions bancaires',
    description: 'Liste les transactions bancaires disponibles.',
    domain: 'cashflow',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'cashflow.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 200 } }, additionalProperties: true },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Transactions bancaires', data: { transactions: await cashflow.listBankTransactions(db, context.store_id, { ...input, limit: limit(input.limit, 50, 200) }) } }),
  }),
  tool({
    name: 'get_recurring_charges',
    title: 'Charges recurrentes',
    description: 'Liste les charges recurrentes de tresorerie.',
    domain: 'cashflow',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'cashflow.read',
    requiresConfirmation: false,
    inputSchema: emptyInputSchema,
    execute: async ({ db, context, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Charges recurrentes', data: { charges: await cashflow.listRecurringCharges(db, context.store_id) } }),
  }),
  tool({
    name: 'get_manual_cashflow_items',
    title: 'Mouvements manuels tresorerie',
    description: 'Liste les mouvements manuels de tresorerie.',
    domain: 'cashflow',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'cashflow.read',
    requiresConfirmation: false,
    inputSchema: emptyInputSchema,
    execute: async ({ db, context, tool: currentTool }) => {
      const manual = require('../cashflow/manualForecastService');
      return response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Mouvements manuels tresorerie', data: { items: await manual.listManualItems(db, context.store_id) } });
    },
  }),
  tool({
    name: 'get_open_customer_invoices',
    title: 'Factures clients ouvertes',
    description: 'Liste les factures clients ouvertes utilisees en tresorerie.',
    domain: 'cashflow',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'cashflow.read',
    requiresConfirmation: false,
    inputSchema: periodInputSchema,
    execute: async ({ db, context, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Factures clients ouvertes', data: { invoices: await cashflow.listCustomerReceivables(db, context.store_id) } }),
  }),
  tool({
    name: 'get_open_supplier_invoices',
    title: 'Factures fournisseurs ouvertes',
    description: 'Liste les factures fournisseurs ouvertes utilisees en tresorerie.',
    domain: 'cashflow',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'cashflow.read',
    requiresConfirmation: false,
    inputSchema: periodInputSchema,
    execute: async ({ db, context, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Factures fournisseurs ouvertes', data: { invoices: await cashflow.listSupplierPayables(db, context.store_id) } }),
  }),
  tool({
    name: 'get_unbilled_sales',
    title: 'Ventes non facturees',
    description: 'Liste commandes et BL non factures exploitables en prevision.',
    domain: 'cashflow',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'cashflow.read',
    requiresConfirmation: false,
    inputSchema: periodInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Ventes non facturees', data: { sales: await cashflow.listUnbilledSales(db, context.store_id, input) } }),
  }),
  tool({
    name: 'get_pending_sales_documents',
    title: 'Documents de vente en attente',
    description: 'Alias metier des ventes non facturees et commandes/BL en cours.',
    domain: 'cashflow',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'cashflow.read',
    requiresConfirmation: false,
    inputSchema: periodInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Documents de vente en attente', data: { documents: await cashflow.listUnbilledSales(db, context.store_id, input) } }),
  }),
  tool({
    name: 'get_cashflow_assumptions',
    title: 'Hypotheses tresorerie',
    description: 'Retourne les hypotheses utilisees par la projection de tresorerie.',
    domain: 'cashflow',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'cashflow.read',
    requiresConfirmation: false,
    inputSchema: periodInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => {
      const projection = await cashflow.buildCashflowProjection(db, context.store_id, input);
      return response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Hypotheses tresorerie', data: { assumptions: projection.assumptions, missing_information: projection.missing_information, warnings: projection.warnings }, source_freshness: projection.source_freshness });
    },
  }),
  tool({
    name: 'get_cashflow_settings',
    title: 'Parametres tresorerie',
    description: 'Lit les parametres de tresorerie.',
    domain: 'cashflow',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'cashflow.read',
    requiresConfirmation: false,
    inputSchema: emptyInputSchema,
    execute: async ({ db, context, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Parametres tresorerie', data: { settings: await cashflow.getSettings(db, context.store_id) } }),
  }),
  tool({
    name: 'simulate_distrimer_payment',
    title: 'Simulation paiement DISTRIMER',
    description: 'Simule un paiement DISTRIMER sans effectuer de paiement reel.',
    domain: 'cashflow',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'cashflow.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: { amount: { type: 'number' }, payment_date: { type: 'string' } }, additionalProperties: true },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Simulation DISTRIMER sans paiement reel', data: await cashflow.simulateDistrimerPayment(db, context.store_id, input), warnings: ['Simulation uniquement: aucun paiement reel n est effectue.'] }),
  }),
  tool({
    name: 'get_distrimer_exposure',
    title: 'Encours DISTRIMER',
    description: 'Lit et calcule l encours DISTRIMER avec la limite configuree.',
    domain: 'cashflow',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'cashflow.read',
    requiresConfirmation: false,
    inputSchema: emptyInputSchema,
    execute: async ({ db, context, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Encours DISTRIMER', data: await cashflow.getDistrimer(db, context.store_id) }),
  }),
  tool({
    name: 'identify_cashflow_risks',
    title: 'Risques tresorerie',
    description: 'Identifie les risques de tresorerie a partir de la projection, des soldes et de DISTRIMER.',
    domain: 'cashflow',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'cashflow.read',
    requiresConfirmation: false,
    inputSchema: periodInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Risques tresorerie', data: { risks: await cashflow.identifyCashflowRisks(db, context.store_id, input) } }),
  }),
  tool({
    name: 'compare_cashflow_scenarios',
    title: 'Comparer scenarios tresorerie',
    description: 'Compare les scenarios prudent, realiste et optimiste.',
    domain: 'cashflow',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'cashflow.read',
    requiresConfirmation: false,
    inputSchema: periodInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Comparaison scenarios tresorerie', data: await cashflow.compareCashflowScenarios(db, context.store_id, input) }),
  }),
  tool({
    name: 'run_cashflow_scenario',
    title: 'Scenario tresorerie',
    description: 'Execute un scenario de tresorerie sans ecriture.',
    domain: 'cashflow',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'cashflow.read',
    requiresConfirmation: false,
    inputSchema: periodInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Scenario tresorerie', data: await cashflow.buildCashflowProjection(db, context.store_id, input) }),
  }),
  tool({
    name: 'prepare_cashflow_plan',
    title: 'Plan de tresorerie',
    description: 'Outil obligatoire et prioritaire pour toute prévision ou analyse globale de trésorerie. Retourne directement la projection ALTA consolidée. Ne pas utiliser les outils génériques de recherche ventes, stock ou fournisseurs pour reconstruire cette projection.',
    domain: 'cashflow',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'cashflow.read',
    requiresConfirmation: false,
    inputSchema: periodInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => {
      const projection = await cashflow.buildCashflowProjection(db, context.store_id, input);
      return response({
        tool: currentTool.name,
        domain: currentTool.domain,
        summary: `Plan de tresorerie ${input.days || 30} jours base sur les donnees ALTA`,
        data: projection,
        warnings: projection.warnings,
        missing_information: projection.missing_information,
        source_freshness: projection.source_freshness,
      });
    },
  }),
  tool({
    name: 'list_quality_documentation',
    title: 'Lister documentation qualite',
    description: 'Liste les collections du dossier qualite.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.documentation.read',
    requiresConfirmation: false,
    inputSchema: emptyInputSchema,
    execute: async ({ db, context, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Collections qualite', data: { collections: await qualityDocumentation.listDocumentation(db, context.store_id) } }),
  }),
  tool({
    name: 'get_quality_documentation_outline',
    title: 'Plan documentation qualite',
    description: 'Retourne le plan des tomes et chapitres.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.documentation.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: { collection_id: { type: 'string' } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Plan documentation qualite', data: await qualityOutline(db, context.store_id, input) }),
  }),
  tool({
    name: 'get_quality_section',
    title: 'Lire chapitre qualite',
    description: 'Lit un chapitre qualite par id, code ou titre.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.documentation.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: { section_id: { type: 'string' }, section_code: { type: 'string' }, code: { type: 'string' }, query: { type: 'string' } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Chapitre qualite', data: { section: await findQualitySection(db, context.store_id, input) } }),
  }),
  tool({
    name: 'get_quality_section_blocks',
    title: 'Blocs chapitre qualite',
    description: 'Lit les blocs structures rattaches a un chapitre qualite.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.documentation.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: { section_id: { type: 'string' }, section_code: { type: 'string' }, code: { type: 'string' }, query: { type: 'string' } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => {
      const data = await qualityContext.getQualitySectionContext(db, context.store_id, input);
      return response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Blocs chapitre qualite', data: { section: data?.section || null, blocks: data?.blocks || [] } });
    },
  }),
  tool({
    name: 'quality.documentation.update_text_block',
    title: 'Modifier bloc texte qualite',
    description: 'Met a jour uniquement un bloc rich_text existant. Ne pas utiliser pour ajouter un nouveau texte, tableau ou diagramme; pour ajouter, appeler add_text_block, add_table_block ou add_diagram_block.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.COMMITTING_ACTION,
    requiredPermission: 'quality.documentation.edit',
    requiresConfirmation: true,
    inputSchema: {
      type: 'object',
      required: ['block_id', 'html'],
      properties: {
        block_id: { type: 'string', description: 'UUID du bloc rich_text a modifier.' },
        html: { type: 'string', description: 'HTML texte du bloc existant. Les tableaux et diagrammes structures sont refuses ici.' },
        title: { type: 'string', description: 'Titre optionnel du bloc.' },
        confirmation: { type: 'string', enum: ['human_confirmed'] },
      },
      additionalProperties: false,
    },
    execute: async ({ db, context, input, tool: currentTool }) => response({
      tool: currentTool.name,
      domain: currentTool.domain,
      summary: 'Bloc texte qualite mis a jour',
      data: await executeExecutableActionDirect({ dbPool: db, context, actionType: currentTool.name, payload: input }),
    }),
  }),
  tool({
    name: 'quality.documentation.add_text_block',
    title: 'Ajouter bloc texte qualite',
    description: 'Cree un nouveau bloc persistant rich_text dans quality_document_blocks avec un nouvel UUID. Accepte chapter_id, section_id ou section_code; ne modifie pas le bloc existant.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.COMMITTING_ACTION,
    requiredPermission: 'quality.documentation.edit',
    requiresConfirmation: true,
    inputSchema: {
      type: 'object',
      required: ['html'],
      properties: {
        chapter_id: { type: 'string', description: 'UUID du chapitre cible.' },
        section_id: { type: 'string', description: 'Alias de chapter_id.' },
        section_code: { type: 'string', description: 'Code du chapitre, par exemple T1-C01.' },
        html: { type: 'string', description: 'HTML du contenu texte.' },
        title: { type: 'string' },
        position: { type: 'number', description: 'Position numerique optionnelle.' },
        confirmation: { type: 'string', enum: ['human_confirmed'] },
      },
      additionalProperties: false,
    },
    execute: async ({ db, context, input, tool: currentTool }) => {
      const chapterId = await resolveQualitySectionId(db, context.store_id, input);
      return response({
        tool: currentTool.name,
        domain: currentTool.domain,
        summary: 'Bloc texte qualite ajoute',
        data: await executeExecutableActionDirect({ dbPool: db, context, actionType: currentTool.name, payload: { ...input, chapter_id: chapterId } }),
      });
    },
  }),
  tool({
    name: 'quality.documentation.add_table_block',
    title: 'Ajouter bloc tableau qualite',
    description: 'Cree un nouveau bloc persistant document_table dans quality_document_blocks avec un nouvel UUID. Fournir chapter_id/section_id/section_code, colonnes et lignes; aucun tableau HTML ne doit etre injecte dans rich_text.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.COMMITTING_ACTION,
    requiredPermission: 'quality.documentation.edit',
    requiresConfirmation: true,
    inputSchema: {
      type: 'object',
      required: ['columns'],
      properties: {
        chapter_id: { type: 'string' },
        section_id: { type: 'string' },
        section_code: { type: 'string' },
        title: { type: 'string' },
        position: { type: 'number' },
        header: { type: 'boolean' },
        columns: {
          type: 'array',
          minItems: 1,
          items: {
            anyOf: [
              { type: 'string' },
              {
                type: 'object',
                required: ['label'],
                properties: { id: { type: 'string' }, label: { type: 'string' }, alignment: { type: 'string', enum: ['left', 'center', 'right'] }, width: { type: 'number' } },
                additionalProperties: false,
              },
            ],
          },
        },
        rows: {
          type: 'array',
          items: {
            anyOf: [
              { type: 'array', items: { type: 'string' } },
              { type: 'object', additionalProperties: true },
            ],
          },
        },
        confirmation: { type: 'string', enum: ['human_confirmed'] },
      },
      additionalProperties: false,
    },
    execute: async ({ db, context, input, tool: currentTool }) => {
      const chapterId = await resolveQualitySectionId(db, context.store_id, input);
      return response({
        tool: currentTool.name,
        domain: currentTool.domain,
        summary: 'Bloc tableau qualite ajoute',
        data: await executeExecutableActionDirect({
          dbPool: db,
          context,
          actionType: currentTool.name,
          payload: { chapter_id: chapterId, title: input.title, position: input.position, content: { table_data: tableDataFromInput(input) } },
        }),
      });
    },
  }),
  tool({
    name: 'quality.documentation.add_diagram_block',
    title: 'Ajouter bloc diagramme qualite',
    description: 'Cree un nouveau bloc persistant mermaid_diagram dans quality_document_blocks avec un nouvel UUID. Fournir nodes et connections, ou source Mermaid en editor_mode mermaid.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.COMMITTING_ACTION,
    requiredPermission: 'quality.documentation.edit',
    requiresConfirmation: true,
    inputSchema: {
      type: 'object',
      properties: {
        chapter_id: { type: 'string' },
        section_id: { type: 'string' },
        section_code: { type: 'string' },
        title: { type: 'string' },
        position: { type: 'number' },
        orientation: { type: 'string', enum: ['vertical', 'horizontal'] },
        editor_mode: { type: 'string', enum: ['structured', 'mermaid'] },
        nodes: {
          type: 'array',
          items: {
            type: 'object',
            required: ['label'],
            properties: { id: { type: 'string' }, label: { type: 'string' }, type: { type: 'string' }, description: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } },
            additionalProperties: true,
          },
        },
        connections: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' } }, additionalProperties: true } },
        edges: { type: 'array', items: { type: 'object', additionalProperties: true } },
        source: { type: 'string', description: 'Source Mermaid si editor_mode vaut mermaid.' },
        rendered_svg: { type: 'string', description: 'SVG Mermaid prerendu optionnel.' },
        confirmation: { type: 'string', enum: ['human_confirmed'] },
      },
      additionalProperties: false,
    },
    execute: async ({ db, context, input, tool: currentTool }) => {
      const chapterId = await resolveQualitySectionId(db, context.store_id, input);
      return response({
        tool: currentTool.name,
        domain: currentTool.domain,
        summary: 'Bloc diagramme qualite ajoute',
        data: await executeExecutableActionDirect({
          dbPool: db,
          context,
          actionType: currentTool.name,
          payload: { chapter_id: chapterId, title: input.title, position: input.position, content: { diagram_data: diagramDataFromInput(input), editor_mode: input.editor_mode } },
        }),
      });
    },
  }),
  tool({
    name: 'quality.documentation.delete_block',
    title: 'Supprimer bloc qualite',
    description: 'Supprime un bloc structure de documentation qualite via le service blocs, avec historique et audit.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.COMMITTING_ACTION,
    requiredPermission: 'quality.documentation.edit',
    requiresConfirmation: true,
    inputSchema: {
      type: 'object',
      required: ['block_id'],
      properties: {
        block_id: { type: 'string', description: 'UUID du bloc a supprimer.' },
        confirmation: { type: 'string', enum: ['human_confirmed'] },
      },
      additionalProperties: false,
    },
    execute: async ({ db, context, input, tool: currentTool }) => response({
      tool: currentTool.name,
      domain: currentTool.domain,
      summary: 'Bloc qualite supprime',
      data: await executeExecutableActionDirect({ dbPool: db, context, actionType: currentTool.name, payload: input }),
    }),
  }),
  tool({
    name: 'quality.documentation.move_block',
    title: 'Reordonner blocs qualite',
    description: 'Reordonne les blocs structures d un chapitre qualite. block_ids doit contenir l ordre complet.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.COMMITTING_ACTION,
    requiredPermission: 'quality.documentation.edit',
    requiresConfirmation: true,
    inputSchema: {
      type: 'object',
      required: ['block_ids'],
      properties: {
        chapter_id: { type: 'string' },
        section_id: { type: 'string' },
        section_code: { type: 'string' },
        block_ids: { type: 'array', minItems: 1, items: { type: 'string' }, description: 'Ordre complet des blocs du chapitre.' },
        confirmation: { type: 'string', enum: ['human_confirmed'] },
      },
      additionalProperties: false,
    },
    execute: async ({ db, context, input, tool: currentTool }) => {
      const chapterId = await resolveQualitySectionId(db, context.store_id, input);
      return response({
        tool: currentTool.name,
        domain: currentTool.domain,
        summary: 'Blocs qualite reordonnes',
        data: await executeExecutableActionDirect({ dbPool: db, context, actionType: currentTool.name, payload: { ...input, chapter_id: chapterId } }),
      });
    },
  }),
  tool({
    name: 'quality.documentation.update_table_cell',
    title: 'Modifier cellule tableau qualite',
    description: 'Modifie une seule cellule d un tableau structure existant avec verification optionnelle de l ancienne valeur. Preserve les autres cellules, lignes, colonnes et le schema.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.COMMITTING_ACTION,
    requiredPermission: 'quality.documentation.edit',
    requiresConfirmation: true,
    inputSchema: {
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
        confirmation: { type: 'string', enum: ['human_confirmed'] },
      },
      additionalProperties: false,
    },
    execute: async ({ db, context, input, tool: currentTool }) => response({
      tool: currentTool.name,
      domain: currentTool.domain,
      summary: 'Cellule tableau qualite mise a jour',
      data: await executeExecutableActionDirect({ dbPool: db, context, actionType: currentTool.name, payload: input }),
    }),
  }),
  tool({
    name: 'quality.documentation.relink_table',
    title: 'Rattacher tableau qualite',
    description: 'Rattache ou repositionne un tableau existant sans copier ni recreer son contenu. Accepte chapter_id, section_id ou section_code.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.COMMITTING_ACTION,
    requiredPermission: 'quality.documentation.edit',
    requiresConfirmation: true,
    inputSchema: {
      type: 'object',
      required: ['table_id'],
      properties: {
        table_id: { type: 'string' },
        chapter_id: { type: 'string' },
        section_id: { type: 'string' },
        section_code: { type: 'string' },
        block_id: { type: 'string' },
        position: { type: 'number' },
        is_visible: { type: 'boolean' },
        dry_run: { type: 'boolean' },
        confirmation: { type: 'string', enum: ['human_confirmed'] },
      },
      additionalProperties: false,
    },
    execute: async ({ db, context, input, tool: currentTool }) => {
      const chapterId = await resolveQualitySectionId(db, context.store_id, input);
      return response({
        tool: currentTool.name,
        domain: currentTool.domain,
        summary: 'Tableau qualite rattache',
        data: await executeExecutableActionDirect({ dbPool: db, context, actionType: currentTool.name, payload: { ...input, chapter_id: chapterId } }),
      });
    },
  }),
  tool({
    name: 'quality.documentation.update_diagram',
    title: 'Modifier diagramme qualite',
    description: 'Modifie de facon ciblee un diagramme existant: titre, source Mermaid, libelle/description de noeud ou liaison.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.COMMITTING_ACTION,
    requiredPermission: 'quality.documentation.edit',
    requiresConfirmation: true,
    inputSchema: {
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
        confirmation: { type: 'string', enum: ['human_confirmed'] },
      },
      additionalProperties: false,
    },
    execute: async ({ db, context, input, tool: currentTool }) => response({
      tool: currentTool.name,
      domain: currentTool.domain,
      summary: 'Diagramme qualite mis a jour',
      data: await executeExecutableActionDirect({ dbPool: db, context, actionType: currentTool.name, payload: input }),
    }),
  }),
  tool({
    name: 'quality.documentation.relink_diagram',
    title: 'Rattacher diagramme qualite',
    description: 'Rattache ou repositionne un diagramme existant sans copier ni recreer son contenu. Accepte chapter_id, section_id ou section_code.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.COMMITTING_ACTION,
    requiredPermission: 'quality.documentation.edit',
    requiresConfirmation: true,
    inputSchema: {
      type: 'object',
      required: ['diagram_id'],
      properties: {
        diagram_id: { type: 'string' },
        chapter_id: { type: 'string' },
        section_id: { type: 'string' },
        section_code: { type: 'string' },
        block_id: { type: 'string' },
        position: { type: 'number' },
        is_visible: { type: 'boolean' },
        dry_run: { type: 'boolean' },
        confirmation: { type: 'string', enum: ['human_confirmed'] },
      },
      additionalProperties: false,
    },
    execute: async ({ db, context, input, tool: currentTool }) => {
      const chapterId = await resolveQualitySectionId(db, context.store_id, input);
      return response({
        tool: currentTool.name,
        domain: currentTool.domain,
        summary: 'Diagramme qualite rattache',
        data: await executeExecutableActionDirect({ dbPool: db, context, actionType: currentTool.name, payload: { ...input, chapter_id: chapterId } }),
      });
    },
  }),
  tool({
    name: 'search_quality_sections',
    title: 'Rechercher chapitres qualite',
    description: 'Recherche dans les codes, titres et textes des chapitres qualite.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.documentation.read',
    requiresConfirmation: false,
    inputSchema: searchInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => {
      const query = `%${text(input.query)}%`;
      const result = await db.query(
        `SELECT id, collection_id, parent_id, code, title, section_type, status, version, updated_at
         FROM quality_documentation_sections
         WHERE store_id = $1 AND archived_at IS NULL
           AND (COALESCE(code,'') ILIKE $2 OR COALESCE(title,'') ILIKE $2 OR COALESCE(content_text,'') ILIKE $2)
         ORDER BY display_order ASC
         LIMIT $3`,
        [context.store_id, query, limit(input.limit, 25, 100)]
      );
      return response({ tool: currentTool.name, domain: currentTool.domain, summary: `${result.rows.length} chapitre(s) qualite`, data: { results: result.rows } });
    },
  }),
  tool({
    name: 'list_quality_missing_items',
    title: 'Informations qualite manquantes',
    description: 'Liste les informations manquantes du dossier qualite.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.documentation.read',
    requiresConfirmation: false,
    inputSchema: searchInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Informations manquantes qualite', data: { items: await qualityDocumentation.listMissingItems(db, context.store_id, input) } }),
  }),
  tool({
    name: 'update_quality_missing_item',
    title: 'Modifier information qualite manquante',
    description: 'Modifie la temporalite/priorite, le responsable ou l echeance d une information manquante qualite. Requiert confirmation humaine.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.COMMITTING_ACTION,
    requiredPermission: 'quality.documentation.edit',
    requiresConfirmation: true,
    inputSchema: qualityMissingItemInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => {
      const itemId = input.missing_item_id || input.id;
      const item = await qualityDocumentation.updateMissingItem(db, context.store_id, itemId, context.user_id, input);
      if (!item) {
        const error = new Error('Information manquante introuvable');
        error.status = 404;
        error.expose = true;
        throw error;
      }
      return response({
        tool: currentTool.name,
        domain: currentTool.domain,
        summary: 'Information manquante modifiee',
        data: { item },
      });
    },
  }),
  tool({
    name: 'resolve_quality_missing_item',
    title: 'Resoudre information qualite manquante',
    description: 'Marque une information manquante qualite comme resolue. Requiert confirmation humaine et conserve l audit.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.COMMITTING_ACTION,
    requiredPermission: 'quality.documentation.edit',
    requiresConfirmation: true,
    inputSchema: qualityMissingItemInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => {
      const itemId = input.missing_item_id || input.id;
      const item = await qualityDocumentation.resolveMissingItem(db, context.store_id, itemId, context.user_id, input);
      if (!item) {
        const error = new Error('Information manquante introuvable');
        error.status = 404;
        error.expose = true;
        throw error;
      }
      return response({
        tool: currentTool.name,
        domain: currentTool.domain,
        summary: 'Information manquante resolue',
        data: { item },
      });
    },
  }),
  tool({
    name: 'reopen_quality_missing_item',
    title: 'Rouvrir information qualite manquante',
    description: 'Rouvre une information manquante qualite resolue. Requiert confirmation humaine et conserve l audit.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.COMMITTING_ACTION,
    requiredPermission: 'quality.documentation.edit',
    requiresConfirmation: true,
    inputSchema: qualityMissingItemInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => {
      const itemId = input.missing_item_id || input.id;
      const item = await qualityDocumentation.reopenMissingItem(db, context.store_id, itemId, context.user_id, input);
      if (!item) {
        const error = new Error('Information manquante introuvable');
        error.status = 404;
        error.expose = true;
        throw error;
      }
      return response({
        tool: currentTool.name,
        domain: currentTool.domain,
        summary: 'Information manquante rouverte',
        data: { item },
      });
    },
  }),
  tool({
    name: 'get_quality_missing_information',
    title: 'Informations qualite manquantes',
    description: 'Alias operationnel listant les informations manquantes qualite.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.documentation.read',
    requiresConfirmation: false,
    inputSchema: searchInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Informations qualite manquantes', data: { items: await qualityDocumentation.listMissingItems(db, context.store_id, input) } }),
  }),
  tool({
    name: 'get_quality_section_versions',
    title: 'Versions chapitre qualite',
    description: 'Liste les versions d un chapitre qualite.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.documentation.read',
    requiresConfirmation: false,
    inputSchema: idInputSchema('section_id'),
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Versions chapitre qualite', data: { versions: await qualityVersions.listSectionVersions(db, context.store_id, input.section_id) } }),
  }),
  tool({
    name: 'draft_quality_section_content',
    title: 'Brouillon chapitre qualite',
    description: 'Prepare une proposition de contenu avec marqueurs d incertitude.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.documentation.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, code: { type: 'string' }, topic: { type: 'string' } }, additionalProperties: true },
    execute: async ({ db, context, input, tool: currentTool }) => {
      const draft = await draftQualitySectionContent(db, context.store_id, input);
      return response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Brouillon qualite prepare depuis les donnees ALTA', data: draft, missing_information: draft.missing_information });
    },
  }),
  tool({
    name: 'draft_quality_section',
    title: 'Rediger chapitre qualite',
    description: 'Prepare une redaction de chapitre a partir du dossier qualite et du contexte ALTA reel.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.documentation.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: { section_id: { type: 'string' }, code: { type: 'string' }, query: { type: 'string' }, topic: { type: 'string' } }, additionalProperties: true },
    execute: async ({ db, context, input, tool: currentTool }) => {
      const draft = await qualityContext.draftQualitySection(db, context.store_id, input);
      return response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Redaction qualite preparee depuis ALTA', data: draft, missing_information: draft.missing_information });
    },
  }),
  tool({
    name: 'preview_quality_section_update',
    title: 'Apercu modification chapitre',
    description: 'Produit un avant/apres avant toute ecriture dans le dossier qualite.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.documentation.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: { section_id: { type: 'string' }, code: { type: 'string' }, query: { type: 'string' }, content_html: { type: 'string' } }, additionalProperties: true },
    execute: async ({ db, context, input, tool: currentTool }) => {
      const preview = await previewQualitySectionUpdate(db, context.store_id, input);
      return response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Apercu modification chapitre qualite', data: preview, missing_information: preview.missing_information });
    },
  }),
  tool({
    name: 'update_quality_section',
    title: 'Modifier chapitre qualite',
    description: 'Compatibilite historique. Execute l action canonique quality.documentation.apply_section_updates via l orchestrateur MCP.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.COMMITTING_ACTION,
    requiredPermission: 'quality.documentation.edit',
    requiresConfirmation: true,
    inputSchema: { type: 'object', required: ['content_html'], properties: { section_id: { type: 'string' }, chapter_id: { type: 'string' }, section_code: { type: 'string' }, code: { type: 'string' }, query: { type: 'string' }, content_html: { type: 'string' }, status: { type: 'string' }, comment_internal: { type: 'string' }, change_summary: { type: 'string' }, pending_action_id: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: true },
    execute: async ({ db, context, input, tool: currentTool }) => {
      const { before, section, versions, actionResult } = await executeQualitySectionCanonicalUpdate(db, context, input);
      return {
        ok: true,
        mode: 'executed',
        tool: currentTool.name,
        action_type: 'quality.documentation.apply_section_updates',
        domain: currentTool.domain,
        target_type: 'quality_section',
        target_id: section?.id || null,
        version_id: versions[0]?.id || null,
        changes: [{ field: 'content_html', before: before?.content_html || '', after: section?.content_html || '' }],
        warnings: [],
        audit_id: null,
        action_result: actionResult.execution_result || actionResult,
      };
    },
  }),
  tool({
    name: 'prepare_quality_section_update',
    title: 'Preparer modification chapitre qualite',
    description: 'Produit un apercu avant/apres et le payload a confirmer pour une modification qualite. Pour creer la pending action, utiliser action_type quality.documentation.apply_section_updates avec payload.updates[].',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.documentation.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: { section_id: { type: 'string' }, code: { type: 'string' }, query: { type: 'string' }, content_html: { type: 'string' } }, additionalProperties: true },
    execute: async ({ db, context, input, tool: currentTool }) => {
      const preview = await qualityContext.previewQualitySectionUpdate(db, context.store_id, input);
      return response({
        tool: currentTool.name,
        domain: currentTool.domain,
        summary: 'Modification qualite preparee',
        data: {
          preview,
          confirmation_tool: 'create_pending_action',
          action_type: 'quality.documentation.apply_section_updates',
          payload: {
            mode: 'all_or_nothing',
            updates: [{ section_id: preview.section_id, content_html: preview.after.content_html }],
          },
        },
        missing_information: preview.missing_information,
      });
    },
  }),
  tool({
    name: 'execute_quality_section_update',
    title: 'Executer modification chapitre qualite',
    description: 'Compatibilite historique. Execute l action canonique quality.documentation.apply_section_updates; preferer les outils de blocs pour modifier le contenu structure.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.COMMITTING_ACTION,
    requiredPermission: 'quality.documentation.edit',
    requiresConfirmation: true,
    inputSchema: { type: 'object', required: ['content_html'], properties: { section_id: { type: 'string' }, chapter_id: { type: 'string' }, section_code: { type: 'string' }, code: { type: 'string' }, query: { type: 'string' }, content_html: { type: 'string' }, status: { type: 'string' }, comment_internal: { type: 'string' }, change_summary: { type: 'string' }, pending_action_id: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: true },
    execute: async ({ db, context, input, tool: currentTool }) => {
      const { before, section, versions, actionResult } = await executeQualitySectionCanonicalUpdate(db, context, input);
      return {
        ok: true,
        mode: 'executed',
        tool: currentTool.name,
        action_type: 'quality.documentation.apply_section_updates',
        domain: currentTool.domain,
        target_type: 'quality_section',
        target_id: section?.id || null,
        version_id: versions[0]?.id || null,
        changes: [{ field: 'content_html', before: before?.content_html || '', after: section?.content_html || '' }],
        warnings: [],
        audit_id: null,
        action_result: actionResult.execution_result || actionResult,
      };
    },
  }),
  tool({
    name: 'create_quality_section',
    title: 'Creer chapitre qualite',
    description: 'Cree un chapitre qualite via le service existant avec version initiale.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'quality.documentation.edit',
    requiresConfirmation: false,
    inputSchema: { type: 'object', required: ['collection_id', 'title'], properties: { collection_id: { type: 'string' }, parent_id: { type: 'string' }, code: { type: 'string' }, title: { type: 'string' }, content_html: { type: 'string' } }, additionalProperties: true },
    execute: async ({ db, context, input, tool: currentTool }) => {
      const section = await qualityDocumentation.createSection(db, context.store_id, input.collection_id, context.user_id, input);
      return response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Chapitre qualite cree', data: { section } });
    },
  }),
  tool({
    name: 'restore_quality_section_version',
    title: 'Restaurer version chapitre',
    description: 'Restaure une version de chapitre apres confirmation humaine.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.COMMITTING_ACTION,
    requiredPermission: 'quality.documentation.edit',
    requiresConfirmation: true,
    inputSchema: { type: 'object', required: ['section_id', 'version_id'], properties: { section_id: { type: 'string' }, version_id: { type: 'string' } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Version restauree', data: { section: await qualityVersions.restoreSectionVersion(db, context.store_id, input.section_id, input.version_id, context.user_id) } }),
  }),
  tool({
    name: 'list_quality_section_tables',
    title: 'Tableaux chapitre qualite',
    description: 'Liste les tableaux associes a un chapitre qualite.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.documentation.read',
    requiresConfirmation: false,
    inputSchema: idInputSchema('section_id'),
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Tableaux qualite', data: { tables: await qualityTables.listTables(db, context.store_id, input.section_id) } }),
  }),
  tool({
    name: 'get_quality_section_tables',
    title: 'Tableaux chapitre qualite',
    description: 'Alias operationnel des tableaux associes a un chapitre qualite.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.documentation.read',
    requiresConfirmation: false,
    inputSchema: idInputSchema('section_id'),
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Tableaux qualite', data: { tables: await qualityTables.listTables(db, context.store_id, input.section_id) } }),
  }),
  tool({
    name: 'quality.documentation.list_all_tables',
    title: 'Inventaire global tableaux qualite',
    description: 'Liste en lecture seule tous les tableaux structures du store, y compris rattaches, non rattaches, masques et archives. Ne modifie jamais les donnees.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.documentation.read',
    requiresConfirmation: false,
    inputSchema: qualityStructuredInventoryListInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => response({
      tool: currentTool.name,
      domain: currentTool.domain,
      summary: 'Inventaire global tableaux qualite',
      data: await qualityStructuredInventory.listAllTables(db, context.store_id, input),
    }),
  }),
  tool({
    name: 'quality.documentation.get_table',
    title: 'Relire tableau qualite',
    description: 'Relit en lecture seule un tableau structure par ID dans le store courant, avec son rattachement eventuel.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.documentation.read',
    requiresConfirmation: false,
    inputSchema: idInputSchema('id'),
    execute: async ({ db, context, input, tool: currentTool }) => response({
      tool: currentTool.name,
      domain: currentTool.domain,
      summary: 'Tableau qualite',
      data: { table: await qualityStructuredInventory.getTable(db, context.store_id, input.id) },
    }),
  }),
  tool({
    name: 'list_quality_section_diagrams',
    title: 'Diagrammes chapitre qualite',
    description: 'Liste les diagrammes associes a un chapitre qualite.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.documentation.read',
    requiresConfirmation: false,
    inputSchema: idInputSchema('section_id'),
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Diagrammes qualite', data: { diagrams: await qualityDiagrams.listDiagrams(db, context.store_id, input.section_id) } }),
  }),
  tool({
    name: 'get_quality_section_diagrams',
    title: 'Diagrammes chapitre qualite',
    description: 'Alias operationnel des diagrammes associes a un chapitre qualite.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.documentation.read',
    requiresConfirmation: false,
    inputSchema: idInputSchema('section_id'),
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Diagrammes qualite', data: { diagrams: await qualityDiagrams.listDiagrams(db, context.store_id, input.section_id) } }),
  }),
  tool({
    name: 'quality.documentation.list_all_diagrams',
    title: 'Inventaire global diagrammes qualite',
    description: 'Liste en lecture seule tous les diagrammes structures du store, y compris rattaches, non rattaches, masques et archives. Ne modifie jamais les donnees.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.documentation.read',
    requiresConfirmation: false,
    inputSchema: qualityStructuredInventoryListInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => response({
      tool: currentTool.name,
      domain: currentTool.domain,
      summary: 'Inventaire global diagrammes qualite',
      data: await qualityStructuredInventory.listAllDiagrams(db, context.store_id, input),
    }),
  }),
  tool({
    name: 'quality.documentation.get_diagram',
    title: 'Relire diagramme qualite',
    description: 'Relit en lecture seule un diagramme structure par ID dans le store courant, avec son rattachement eventuel.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.documentation.read',
    requiresConfirmation: false,
    inputSchema: idInputSchema('id'),
    execute: async ({ db, context, input, tool: currentTool }) => response({
      tool: currentTool.name,
      domain: currentTool.domain,
      summary: 'Diagramme qualite',
      data: { diagram: await qualityStructuredInventory.getDiagram(db, context.store_id, input.id) },
    }),
  }),
  tool({
    name: 'quality.documentation.diagnose_structured_objects',
    title: 'Diagnostic objets structures qualite',
    description: 'Compte en lecture seule les tableaux et diagrammes du store et explique les ecarts entre inventaire global et outils limites au chapitre.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.documentation.read',
    requiresConfirmation: false,
    inputSchema: emptyInputSchema,
    execute: async ({ db, context, tool: currentTool }) => response({
      tool: currentTool.name,
      domain: currentTool.domain,
      summary: 'Diagnostic objets structures qualite',
      data: await qualityStructuredInventory.diagnoseStructuredObjects(db, context.store_id),
    }),
  }),
  tool({
    name: 'get_quality_section_attachments',
    title: 'Pieces jointes chapitre qualite',
    description: 'Liste les pieces jointes et documents rattaches au chapitre.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.documentation.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: { section_id: { type: 'string' }, code: { type: 'string' }, query: { type: 'string' } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => {
      const data = await qualityContext.getQualitySectionContext(db, context.store_id, input);
      return response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Pieces jointes chapitre qualite', data: { attachments: data?.attachments || [], documents: data?.documents || [], photos: data?.photos || [] } });
    },
  }),
  tool({
    name: 'get_quality_context',
    title: 'Contexte qualite ALTA',
    description: 'Agrege zones, equipements, releves, nettoyage, taches, documents et photos qualite.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 200 } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => {
      const data = await qualityContext.getQualityContext(db, context.store_id, input);
      return response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Contexte qualite ALTA', data, source_freshness: data.source_freshness });
    },
  }),
  tool({
    name: 'get_quality_today_work',
    title: 'Lire qualite du jour',
    description: 'Retourne le poste de travail operationnel qualite: a faire, retards, a venir, realises aujourd hui et non-conformites ouvertes.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: { include_upcoming: { type: 'string', enum: ['true', 'false'] } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Qualite du jour', data: await qualityOperations.listQualityTodayWork(db, context.store_id, input) }),
  }),
  tool({
    name: 'get_quality_overdue_work',
    title: 'Lire retards qualite',
    description: 'Retourne les controles qualite en retard depuis le poste operationnel.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async ({ db, context, tool: currentTool }) => {
      const work = await qualityOperations.listQualityTodayWork(db, context.store_id, { include_upcoming: 'false' });
      return response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Retards qualite', data: { overdue: work.sections.overdue, summary: { overdue: work.summary.overdue } } });
    },
  }),
  tool({
    name: 'get_quality_ddpp_dashboard',
    title: 'Lire tableau DDPP',
    description: 'Retourne la situation qualite DDPP en lecture seule: controles du jour, temperatures, nettoyages, non-conformites et actions correctives.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: {
      start_date: { type: 'string' },
      end_date: { type: 'string' },
      type: { type: 'string', enum: ['temperature', 'cleaning', 'manual_task', 'manual', 'control'] },
      zone_id: { type: 'string' },
      equipment_id: { type: 'string' },
      operator_user_id: { type: 'string' },
      conformity_status: { type: 'string', enum: ['conform', 'non_conform', 'not_applicable'] },
      nc_status: { type: 'string', enum: ['open', 'in_progress', 'closed', 'cancelled'] },
      severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
      action_status: { type: 'string', enum: ['open', 'in_progress', 'completed', 'cancelled'] },
      alert_status: { type: 'string', enum: ['compliant', 'warning', 'out_of_limits'] },
      cleaning_status: { type: 'string' },
    }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Dashboard DDPP qualite', data: await qualityOperations.getDdppDashboard(db, context.store_id, input) }),
  }),
  tool({
    name: 'get_quality_ddpp_record_detail',
    title: 'Lire detail DDPP',
    description: 'Relit le detail DDPP d un releve temperature, nettoyage ou tache manuelle avec occurrence, tache, non-conformites et actions correctives liees.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', required: ['type', 'id'], properties: { type: { type: 'string', enum: ['temperature', 'cleaning', 'manual_task', 'manual', 'control'] }, id: { type: 'string' } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => {
      const data = await qualityOperations.getDdppRecordDetail(db, context.store_id, input.type, input.id);
      if (!data) return response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Detail DDPP introuvable', data: null });
      return response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Detail DDPP qualite', data });
    },
  }),
  tool({
    name: 'list_quality_temperature_types',
    title: 'Lister types temperature',
    description: 'Liste les codes actifs de parametrage temperature exposes par le front via /api/quality/temperatures/types. Appeler avant create_quality_temperature_parameter ou update_quality_temperature_parameter.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async ({ db, tool: currentTool }) => {
      const rows = await qualityTemperatures.listTemperatureTypes(db);
      const types = rows.map((row) => ({
        code: row.code,
        label: row.label,
        name: row.label,
        default_unit: row.default_unit,
        unit: row.default_unit,
        category: row.category,
        active: row.is_active !== false,
      }));
      return response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Types temperature actifs', data: { types } });
    },
  }),
  tool({
    name: 'list_quality_temperature_parameters',
    title: 'Lister parametres temperature',
    description: 'Liste les parametres temperature exposes par le front via /api/quality/temperatures/limits.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: { type: { type: 'string' }, type_code: { type: 'string' }, zone_id: { type: 'string' }, equipment_id: { type: 'string' }, quality_task_id: { type: 'string' }, active_only: { type: 'string', enum: ['true', 'false'] } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Parametres temperature', data: { parameters: await qualityTemperatures.listTemperatureLimits(db, context.store_id, input) } }),
  }),
  tool({
    name: 'get_quality_temperature_parameter',
    title: 'Relire parametre temperature',
    description: 'Relit un parametre temperature par le service quality/temperatures.getTemperatureLimit.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.read',
    requiresConfirmation: false,
    inputSchema: qualityParameterStatusInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => {
      const id = qualityId(input, 'temperature_parameter_id', 'parameter_id', 'limit_id', 'id');
      const parameter = await qualityTemperatures.getTemperatureLimit(db, context.store_id, id);
      return response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Parametre temperature', data: { parameter } });
    },
  }),
  tool({
    name: 'create_quality_temperature_parameter',
    title: 'Creer parametre temperature',
    description: 'Cree un parametrage temperature natif, avec jours actifs scheduled_days et horaires multiples target_times. ALTA synchronise une tache SYSTEM canonique et genere les occurrences par jour/horaire. Appeler list_quality_temperature_types avant pour choisir un type_code valide.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'quality.configuration.write',
    requiresConfirmation: false,
    inputSchema: qualityTemperatureParameterInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => {
      const payload = temperatureValidators.mapLimitPayload(input);
      const validationError = temperatureValidators.validateLimitPayload(payload);
      if (validationError) throw Object.assign(new Error(validationError), { status: 400, expose: true });
      const parameter = await qualityTemperatures.saveTemperatureLimit(db, context.store_id, context.user_id, payload);
      const planning = { planning_mode: 'native_temperature_sync', quality_task_id: parameter.quality_task_id || null, schedule_tasks: parameter.schedule_tasks || [] };
      return {
        ...response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Parametre temperature cree', data: { parameter, planning } }),
        target_type: 'quality_temperature_limit',
        target_id: parameter.id,
      };
    },
  }),
  tool({
    name: 'update_quality_temperature_parameter',
    title: 'Modifier parametre temperature',
    description: 'Modifie un parametrage temperature natif, ses jours actifs scheduled_days et ses horaires multiples target_times, sans toucher aux releves historiques. ALTA synchronise la tache SYSTEM canonique et ses occurrences attendues.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'quality.configuration.write',
    requiresConfirmation: false,
    inputSchema: { ...qualityTemperatureParameterInputSchema, required: ['temperature_parameter_id', 'type_code'] },
    execute: async ({ db, context, input, tool: currentTool }) => {
      const id = qualityId(input, 'temperature_parameter_id', 'parameter_id', 'limit_id', 'id');
      const payload = temperatureValidators.mapLimitPayload(input);
      const validationError = temperatureValidators.validateLimitPayload(payload);
      if (validationError) throw Object.assign(new Error(validationError), { status: 400, expose: true });
      const parameter = await qualityTemperatures.saveTemperatureLimit(db, context.store_id, context.user_id, payload, id);
      if (!parameter) throw Object.assign(new Error('Parametre temperature introuvable'), { status: 404, expose: true });
      const planning = { planning_mode: 'native_temperature_sync', quality_task_id: parameter.quality_task_id || null, schedule_tasks: parameter.schedule_tasks || [] };
      return {
        ...response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Parametre temperature modifie', data: { parameter, planning } }),
        target_type: 'quality_temperature_limit',
        target_id: parameter.id,
      };
    },
  }),
  tool({
    name: 'archive_or_disable_quality_temperature_parameter',
    title: 'Archiver parametre temperature',
    description: 'Desactive logiquement un parametrage temperature via le meme service que DELETE /api/quality/temperatures/limits/:id.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'quality.configuration.write',
    requiresConfirmation: false,
    inputSchema: qualityParameterStatusInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => {
      const id = qualityId(input, 'temperature_parameter_id', 'parameter_id', 'limit_id', 'id');
      const parameter = await qualityTemperatures.deleteTemperatureLimit(db, context.store_id, context.user_id, id);
      if (!parameter) throw Object.assign(new Error('Parametre temperature introuvable'), { status: 404, expose: true });
      return {
        ...response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Parametre temperature desactive', data: { mode: 'archived', parameter } }),
        target_type: 'quality_temperature_limit',
        target_id: parameter.id,
      };
    },
  }),
  tool({
    name: 'list_quality_cleaning_plans',
    title: 'Lister plans nettoyage',
    description: 'Liste les plans de nettoyage exposes par le front via /api/quality/cleaning/plans.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: { zone_id: { type: 'string' }, equipment_id: { type: 'string' }, quality_task_id: { type: 'string' }, active: { type: 'string', enum: ['true', 'false'] } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Plans nettoyage', data: { plans: await qualityCleaning.listCleaningPlans(db, context.store_id, input) } }),
  }),
  tool({
    name: 'get_quality_cleaning_plan',
    title: 'Relire plan nettoyage',
    description: 'Relit un plan de nettoyage via quality/cleaning.getCleaningPlan.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, cleaning_plan_id: { type: 'string' }, plan_id: { type: 'string' } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => {
      const id = qualityId(input, 'cleaning_plan_id', 'plan_id', 'id');
      const plan = await qualityCleaning.getCleaningPlan(db, context.store_id, id);
      return response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Plan nettoyage', data: { plan } });
    },
  }),
  tool({
    name: 'create_quality_cleaning_plan',
    title: 'Creer plan nettoyage',
    description: 'Cree un plan de nettoyage comme le front, avec les champs de planification qualite visibles dans l interface.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'quality.configuration.write',
    requiresConfirmation: false,
    inputSchema: qualityCleaningPlanConfigurationInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => {
      const payload = cleaningValidators.mapPlanPayload(input);
      const validationError = cleaningValidators.validatePlanPayload(payload);
      if (validationError) throw Object.assign(new Error(validationError), { status: 400, expose: true });
      const plan = await qualityCleaning.saveCleaningPlan(db, context.store_id, context.user_id, payload);
      return {
        ...response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Plan nettoyage cree', data: { plan, synchronized_task: plan.quality_task || null } }),
        target_type: 'quality_cleaning_plan',
        target_id: plan.id,
      };
    },
  }),
  tool({
    name: 'update_quality_cleaning_plan',
    title: 'Modifier plan nettoyage',
    description: 'Modifie un plan de nettoyage comme le front, en conservant la logique metier du service cleaning.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'quality.configuration.write',
    requiresConfirmation: false,
    inputSchema: { ...qualityCleaningPlanConfigurationInputSchema, required: ['cleaning_plan_id', 'title'] },
    execute: async ({ db, context, input, tool: currentTool }) => {
      const id = qualityId(input, 'cleaning_plan_id', 'plan_id', 'id');
      const before = await qualityCleaning.getCleaningPlan(db, context.store_id, id);
      if (!before) throw Object.assign(new Error('Plan de nettoyage introuvable'), { status: 404, expose: true });
      const payload = cleaningValidators.mapPlanPayload({ ...before, ...input });
      const validationError = cleaningValidators.validatePlanPayload(payload);
      if (validationError) throw Object.assign(new Error(validationError), { status: 400, expose: true });
      const plan = await qualityCleaning.saveCleaningPlan(db, context.store_id, context.user_id, payload, id);
      return {
        ...response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Plan nettoyage modifie', data: { plan, synchronized_task: plan.quality_task || null } }),
        target_type: 'quality_cleaning_plan',
        target_id: plan.id,
      };
    },
  }),
  tool({
    name: 'archive_or_disable_quality_cleaning_plan',
    title: 'Archiver plan nettoyage',
    description: 'Desactive logiquement un plan de nettoyage via le meme service que PATCH /api/quality/cleaning/plans/:id/status.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'quality.configuration.write',
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, cleaning_plan_id: { type: 'string' }, plan_id: { type: 'string' } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => {
      const id = qualityId(input, 'cleaning_plan_id', 'plan_id', 'id');
      const plan = await qualityCleaning.changeCleaningPlanStatus(db, context.store_id, context.user_id, id, false);
      if (!plan) throw Object.assign(new Error('Plan de nettoyage introuvable'), { status: 404, expose: true });
      return {
        ...response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Plan nettoyage desactive', data: { mode: 'archived', plan } }),
        target_type: 'quality_cleaning_plan',
        target_id: plan.id,
      };
    },
  }),
  tool({
    name: 'quality_create_task',
    title: 'Creer tache qualite',
    description: 'Cree une tache de configuration qualite MANUAL en brouillon/a valider a partir des zones et equipements existants, sans toucher aux historiques. Les taches SYSTEM sont generees par leur source ALTA native.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'quality.configuration.write',
    requiresConfirmation: false,
    inputSchema: qualityTaskConfigurationInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => {
      const result = await qualityConfiguration.createTask(db, context, input);
      return {
        ...response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Tache qualite creee', data: { task: result.task, summary: result.summary } }),
        target_type: 'quality_task',
        target_id: result.task.id,
      };
    },
  }),
  tool({
    name: 'quality_update_task',
    title: 'Modifier tache qualite',
    description: 'Modifie une tache qualite MANUAL non executee uniquement; refuse les taches completees, avec historique ou SYSTEM verrouillees par une source ALTA native.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'quality.configuration.write',
    requiresConfirmation: false,
    inputSchema: { ...qualityTaskConfigurationInputSchema, required: ['task_id', 'title'] },
    execute: async ({ db, context, input, tool: currentTool }) => {
      const result = await qualityConfiguration.updateTask(db, context, input);
      return {
        ...response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Tache qualite modifiee', data: { task: result.task, summary: result.summary } }),
        target_type: 'quality_task',
        target_id: result.task.id,
      };
    },
  }),
  tool({
    name: 'quality_create_cleaning_plan',
    title: 'Creer plan de nettoyage',
    description: 'Cree un plan de nettoyage en brouillon/a valider; les champs chimiques peuvent rester a completer et bloquent alors l activation.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'quality.configuration.write',
    requiresConfirmation: false,
    inputSchema: qualityCleaningPlanConfigurationInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => {
      const result = await qualityConfiguration.createCleaningPlan(db, context, input);
      return {
        ...response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Plan de nettoyage cree', data: { plan: result.plan, summary: result.summary } }),
        target_type: 'quality_cleaning_plan',
        target_id: result.plan.id,
      };
    },
  }),
  tool({
    name: 'quality_update_cleaning_plan',
    title: 'Modifier plan de nettoyage',
    description: 'Modifie un plan de nettoyage existant et refuse son activation si les informations operationnelles obligatoires manquent.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'quality.configuration.write',
    requiresConfirmation: false,
    inputSchema: { ...qualityCleaningPlanConfigurationInputSchema, required: ['cleaning_plan_id', 'title'] },
    execute: async ({ db, context, input, tool: currentTool }) => {
      const result = await qualityConfiguration.updateCleaningPlan(db, context, input);
      return {
        ...response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Plan de nettoyage modifie', data: { plan: result.plan, summary: result.summary } }),
        target_type: 'quality_cleaning_plan',
        target_id: result.plan.id,
      };
    },
  }),
  tool({
    name: 'quality_assign_task_to_zone',
    title: 'Associer tache a zone',
    description: 'Associe une tache qualite non executee a une zone du meme magasin.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'quality.configuration.write',
    requiresConfirmation: false,
    inputSchema: { ...qualityTaskAssignmentInputSchema, required: ['task_id', 'zone_id'] },
    execute: async ({ db, context, input, tool: currentTool }) => {
      const result = await qualityConfiguration.assignTaskToTarget(db, context, input, 'zone');
      return {
        ...response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Tache associee a la zone', data: { task: result.task, summary: result.summary } }),
        target_type: 'quality_task',
        target_id: result.task.id,
      };
    },
  }),
  tool({
    name: 'quality_assign_task_to_equipment',
    title: 'Associer tache a equipement',
    description: 'Associe une tache qualite non executee a un equipement du meme magasin.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'quality.configuration.write',
    requiresConfirmation: false,
    inputSchema: { ...qualityTaskAssignmentInputSchema, required: ['task_id', 'equipment_id'] },
    execute: async ({ db, context, input, tool: currentTool }) => {
      const result = await qualityConfiguration.assignTaskToTarget(db, context, input, 'equipment');
      return {
        ...response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Tache associee a l equipement', data: { task: result.task, summary: result.summary } }),
        target_type: 'quality_task',
        target_id: result.task.id,
      };
    },
  }),
  tool({
    name: 'quality_activate_configuration',
    title: 'Activer configuration qualite',
    description: 'Active explicitement une tache ou un plan de nettoyage; refuse les plans incomplets.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.COMMITTING_ACTION,
    requiredPermission: 'quality.configuration.write',
    requiresConfirmation: true,
    inputSchema: qualityConfigurationStatusInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => {
      const result = await qualityConfiguration.changeConfigurationStatus(db, context, input, true);
      return {
        ...response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Configuration qualite activee', data: result }),
        target_type: input.type,
        target_id: input.id || input.task_id || input.cleaning_plan_id || input.plan_id || null,
      };
    },
  }),
  tool({
    name: 'quality_deactivate_configuration',
    title: 'Desactiver configuration qualite',
    description: 'Desactive logiquement une tache ou un plan de nettoyage sans suppression physique.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'quality.configuration.write',
    requiresConfirmation: false,
    inputSchema: qualityConfigurationStatusInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => {
      const result = await qualityConfiguration.changeConfigurationStatus(db, context, input, false);
      return {
        ...response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Configuration qualite desactivee', data: result }),
        target_type: input.type,
        target_id: input.id || input.task_id || input.cleaning_plan_id || input.plan_id || null,
      };
    },
  }),
  tool({
    name: 'execute_quality_temperature_occurrence',
    title: 'Executer occurrence temperature',
    description: 'Saisit un releve temperature metier et complete l occurrence/tache liee. Une tache temperature SYSTEM ne peut pas etre terminee sans ce releve.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'quality.record.create',
    requiresConfirmation: false,
    inputSchema: { ...qualityOccurrenceExecutionInputSchema, required: ['quality_task_id', 'type_code', 'value'] },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Releve temperature enregistre', data: await qualityOperations.executeTemperatureOccurrence(db, context.store_id, context.user_id, input) }),
  }),
  tool({
    name: 'execute_quality_cleaning_occurrence',
    title: 'Executer occurrence nettoyage',
    description: 'Cree un enregistrement nettoyage metier et complete l occurrence/tache liee. Une tache nettoyage SYSTEM ne peut pas etre terminee sans cet enregistrement.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'quality.record.create',
    requiresConfirmation: false,
    inputSchema: { ...qualityOccurrenceExecutionInputSchema, required: ['cleaning_plan_id'] },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Nettoyage enregistre', data: await qualityOperations.executeCleaningOccurrence(db, context.store_id, context.user_id, input) }),
  }),
  tool({
    name: 'execute_quality_manual_occurrence',
    title: 'Executer occurrence manuelle',
    description: 'Complete une tache MANUAL ou un controle non verrouille. Refuse les taches SYSTEM verrouillees qui exigent un formulaire metier.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'quality.record.create',
    requiresConfirmation: false,
    inputSchema: { ...qualityOccurrenceExecutionInputSchema, required: ['quality_task_id'] },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Tache manuelle realisee', data: await qualityOperations.executeManualOccurrence(db, context.store_id, context.user_id, input) }),
  }),
  tool({
    name: 'create_quality_non_conformity',
    title: 'Creer non-conformite qualite',
    description: 'Cree une non-conformite liee a un releve, nettoyage, occurrence, tache, zone ou equipement.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'quality.nc.manage',
    requiresConfirmation: false,
    inputSchema: qualityNonConformityInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Non-conformite creee', data: { non_conformity: await qualityOperations.createNonConformity(db, context.store_id, context.user_id, input) } }),
  }),
  tool({
    name: 'create_quality_corrective_action',
    title: 'Creer action corrective qualite',
    description: 'Cree une action corrective liee a une non-conformite ou a une tache qualite.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'quality.action.manage',
    requiresConfirmation: false,
    inputSchema: qualityCorrectiveActionInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Action corrective creee', data: { corrective_action: await qualityOperations.createCorrectiveAction(db, context.store_id, context.user_id, input) } }),
  }),
  tool({
    name: 'close_quality_non_conformity',
    title: 'Clore non-conformite qualite',
    description: 'Cloture une non-conformite. Action engageante avec confirmation humaine obligatoire.',
    domain: 'quality',
    riskLevel: RISK_LEVELS.COMMITTING_ACTION,
    requiredPermission: 'quality.nc.manage',
    requiresConfirmation: true,
    inputSchema: { type: 'object', required: ['non_conformity_id'], properties: { non_conformity_id: { type: 'string' }, closure_comment: { type: 'string' } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => {
      const result = await qualityOperations.closeNonConformity(db, context.store_id, context.user_id, input.non_conformity_id, input);
      if (!result) throw Object.assign(new Error('Non-conformite introuvable'), { status: 404, expose: true });
      return response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Non-conformite cloturee', data: { non_conformity: result } });
    },
  }),
  tool({
    name: 'list_supplies_materials',
    title: 'Lister fournitures et materiels',
    description: 'Liste le referentiel central fournitures, consommables, emballages et petits materiels hors articles commerciaux.',
    domain: 'supplies_materials',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'supplies_materials.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, search: { type: 'string' }, category: { type: 'string' }, supplier_id: { type: 'string' }, active: { type: 'boolean' }, food_contact: { type: 'boolean' }, include_archived: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Fournitures et materiels', data: { materials: await suppliesMaterials.listSuppliesMaterials(db, context.store_id, input) } }),
  }),
  tool({
    name: 'search_supplies_materials',
    title: 'Rechercher fournitures et materiels',
    description: 'Recherche dans les codes, noms, marques, descriptions et references fournisseurs du referentiel fournitures.',
    domain: 'supplies_materials',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'supplies_materials.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, category: { type: 'string' }, supplier_id: { type: 'string' }, active: { type: 'boolean' }, food_contact: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Recherche fournitures et materiels', data: { materials: await suppliesMaterials.searchSuppliesMaterials(db, context.store_id, input) } }),
  }),
  tool({
    name: 'get_supply_material',
    title: 'Lire une fourniture ou materiel',
    description: 'Lit une fiche du referentiel avec fournisseur, documents maitres et liaisons metier.',
    domain: 'supplies_materials',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'supplies_materials.read',
    requiresConfirmation: false,
    inputSchema: idInputSchema('supply_material_id'),
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Detail fourniture ou materiel', data: { material: await suppliesMaterials.getSupplyMaterial(db, context.store_id, input.supply_material_id || input.id) } }),
  }),
  tool({
    name: 'list_supply_material_documents',
    title: 'Lister documents d une fourniture',
    description: 'Liste les documents maitres rattaches a une fourniture sans exposer de stockage parallele.',
    domain: 'supplies_materials',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'supplies_materials.read',
    requiresConfirmation: false,
    inputSchema: idInputSchema('supply_material_id'),
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Documents fourniture', data: { documents: await suppliesMaterials.listSupplyMaterialDocuments(db, context.store_id, input.supply_material_id || input.id) } }),
  }),
  tool({
    name: 'list_supply_material_links',
    title: 'Lister liaisons d une fourniture',
    description: 'Liste les liaisons vers zones, equipements, plans de nettoyage, taches et procedures.',
    domain: 'supplies_materials',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'supplies_materials.read',
    requiresConfirmation: false,
    inputSchema: idInputSchema('supply_material_id'),
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Liaisons fourniture', data: { links: await suppliesMaterials.listSupplyMaterialLinks(db, context.store_id, input.supply_material_id || input.id) } }),
  }),
  tool({
    name: 'create_supply_material',
    title: 'Creer fourniture ou materiel',
    description: 'Cree une fiche referentiel fournitures et materiels. Action de configuration controlee.',
    domain: 'supplies_materials',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'supplies_materials.write',
    requiresConfirmation: false,
    inputSchema: supplyMaterialInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Fourniture creee', data: { material: await suppliesMaterials.createSupplyMaterial(db, context.store_id, context.user_id, input) } }),
  }),
  tool({
    name: 'update_supply_material',
    title: 'Modifier fourniture ou materiel',
    description: 'Modifie une fiche referentiel fournitures et materiels sans toucher aux documents physiques.',
    domain: 'supplies_materials',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'supplies_materials.write',
    requiresConfirmation: false,
    inputSchema: { ...supplyMaterialInputSchema, required: ['supply_material_id', 'name', 'category'] },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Fourniture modifiee', data: { material: await suppliesMaterials.updateSupplyMaterial(db, context.store_id, context.user_id, input.supply_material_id || input.material_id || input.id, input) } }),
  }),
  tool({
    name: 'archive_supply_material',
    title: 'Archiver fourniture ou materiel',
    description: 'Archive logiquement une fiche fournitures et materiels. Aucune suppression physique.',
    domain: 'supplies_materials',
    riskLevel: RISK_LEVELS.COMMITTING_ACTION,
    requiredPermission: 'supplies_materials.archive',
    requiresConfirmation: true,
    inputSchema: idInputSchema('supply_material_id'),
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Fourniture archivee', data: { material: await suppliesMaterials.archiveSupplyMaterial(db, context.store_id, context.user_id, input.supply_material_id || input.id) } }),
  }),
  tool({
    name: 'add_supply_material_document_reference',
    title: 'Rattacher document maitre a fourniture',
    description: 'Ajoute une reference vers quality_master_documents pour une fourniture, sans dupliquer le fichier.',
    domain: 'supplies_materials',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'supplies_materials.documents',
    requiresConfirmation: false,
    inputSchema: { type: 'object', required: ['supply_material_id', 'document_id'], properties: { supply_material_id: { type: 'string' }, document_id: { type: 'string' }, relation_type: { type: 'string', enum: [...suppliesMaterials.SUPPLY_MATERIAL_DOCUMENT_TYPES, 'reference'] }, label: { type: 'string' } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Document rattache a la fourniture', data: { reference: await suppliesMaterials.addSupplyMaterialDocumentReference(db, context.store_id, context.user_id, input) } }),
  }),
  tool({
    name: 'add_supply_material_link',
    title: 'Ajouter liaison fourniture',
    description: 'Lie une fourniture a une zone, equipement, plan de nettoyage, tache, procedure ou chapitre PMS.',
    domain: 'supplies_materials',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'supplies_materials.write',
    requiresConfirmation: false,
    inputSchema: supplyMaterialLinkInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Liaison fourniture ajoutee', data: { link: await suppliesMaterials.addSupplyMaterialLink(db, context.store_id, context.user_id, input) } }),
  }),
  tool({
    name: 'archive_supply_material_link',
    title: 'Archiver liaison fourniture',
    description: 'Archive logiquement une liaison metier de fourniture.',
    domain: 'supplies_materials',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'supplies_materials.write',
    requiresConfirmation: false,
    inputSchema: idInputSchema('link_id'),
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Liaison fourniture archivee', data: { link: await suppliesMaterials.archiveSupplyMaterialLink(db, context.store_id, context.user_id, input.link_id || input.id) } }),
  }),
  tool({
    name: 'diagnose_supplies_materials',
    title: 'Diagnostiquer fournitures et materiels',
    description: 'Diagnostic lecture seule: fournisseur manquant, FT/FDS manquantes, declarations contact alimentaire, doublons et plans encore en texte libre.',
    domain: 'supplies_materials',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'supplies_materials.read',
    requiresConfirmation: false,
    inputSchema: emptyInputSchema,
    execute: async ({ db, context, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Diagnostic fournitures et materiels', data: await suppliesMaterials.diagnoseSuppliesMaterials(db, context.store_id) }),
  }),
  tool({
    name: 'list_quality_master_documents',
    title: 'Lister documents maitres qualite',
    description: 'Liste le referentiel documentaire maitre qualite sans dupliquer les fichiers existants.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.documentation.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, status: { type: 'string' }, document_type: { type: 'string' }, category: { type: 'string' }, include_archived: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 200 } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Documents maitres qualite', data: { documents: await qualityMasterDocuments.listMasterDocuments(db, context.store_id, input) } }),
  }),
  tool({
    name: 'get_quality_master_document',
    title: 'Lire document maitre qualite',
    description: 'Lit une fiche documentaire maitre et ses references entrantes.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.documentation.read',
    requiresConfirmation: false,
    inputSchema: idInputSchema('document_id'),
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Detail document maitre qualite', data: { document: await qualityMasterDocuments.getMasterDocument(db, context.store_id, input.document_id || input.id) } }),
  }),
  tool({
    name: 'create_quality_master_document',
    title: 'Creer document maitre qualite',
    description: 'Cree une fiche documentaire maitre sans copier ni supprimer de fichier.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'quality.documentation.edit',
    requiresConfirmation: false,
    inputSchema: qualityMasterDocumentInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Document maitre cree', data: { document: await qualityMasterDocuments.createMasterDocument(db, context.store_id, context.user_id, input) } }),
  }),
  tool({
    name: 'update_quality_master_document',
    title: 'Modifier document maitre qualite',
    description: 'Modifie les metadonnees centralisees d une fiche documentaire maitre.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'quality.documentation.edit',
    requiresConfirmation: false,
    inputSchema: { ...qualityMasterDocumentInputSchema, required: ['document_id', 'title', 'document_type'] },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Document maitre modifie', data: { document: await qualityMasterDocuments.updateMasterDocument(db, context.store_id, input.document_id, context.user_id, input) } }),
  }),
  tool({
    name: 'archive_quality_master_document',
    title: 'Archiver document maitre qualite',
    description: 'Archive logiquement une fiche documentaire maitre. Le fichier physique n est jamais supprime.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.COMMITTING_ACTION,
    requiredPermission: 'quality.documentation.edit',
    requiresConfirmation: true,
    inputSchema: idInputSchema('document_id'),
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Document maitre archive', data: { document: await qualityMasterDocuments.archiveMasterDocument(db, context.store_id, input.document_id || input.id, context.user_id) } }),
  }),
  tool({
    name: 'link_existing_attachment_to_master_document',
    title: 'Rattacher piece existante a document maitre',
    description: 'Cree ou reutilise une fiche maitre depuis une piece existante, sans copie et sans suppression physique.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'quality.documentation.edit',
    requiresConfirmation: false,
    inputSchema: { type: 'object', required: ['source_type', 'source_id'], properties: { source_type: { type: 'string', enum: ['quality_documentation_attachment', 'quality_document', 'quality_photo'] }, source_id: { type: 'string' }, title: { type: 'string' }, document_type: { type: 'string' }, category: { type: 'string' }, source_type_master: { type: 'string', enum: ['CCI', 'laboratoire', 'prestataire', 'administration', 'fournisseur', 'interne'] }, issuer_name: { type: 'string' }, reference_number: { type: 'string' }, valid_until: { type: 'string' }, status: { type: 'string' } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Piece existante rattachee au referentiel maitre', data: await qualityMasterDocuments.linkExistingAttachmentToMasterDocument(db, context.store_id, context.user_id, input) }),
  }),
  tool({
    name: 'add_quality_document_reference',
    title: 'Ajouter reference documentaire qualite',
    description: 'Lie un document maitre a un chapitre, bloc, objet qualite, plan, parametre, non-conformite, action, vue DDPP ou procedure future.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'quality.documentation.edit',
    requiresConfirmation: false,
    inputSchema: qualityDocumentReferenceInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Reference documentaire ajoutee', data: { reference: await qualityMasterDocuments.addDocumentReference(db, context.store_id, context.user_id, input) } }),
  }),
  tool({
    name: 'archive_quality_document_reference',
    title: 'Archiver reference documentaire qualite',
    description: 'Archive logiquement une reference sans supprimer la fiche maitre ni le fichier.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'quality.documentation.edit',
    requiresConfirmation: false,
    inputSchema: idInputSchema('reference_id'),
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Reference documentaire archivee', data: { reference: await qualityMasterDocuments.archiveDocumentReference(db, context.store_id, context.user_id, input.reference_id || input.id) } }),
  }),
  tool({
    name: 'list_quality_document_references',
    title: 'Lister references documentaires qualite',
    description: 'Liste les references documentaires selon document ou cible.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.documentation.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: { document_id: { type: 'string' }, target_type: { type: 'string' }, target_id: { type: 'string' }, include_archived: { type: 'boolean' } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'References documentaires qualite', data: { references: await qualityMasterDocuments.listDocumentReferences(db, context.store_id, input) } }),
  }),
  tool({
    name: 'list_quality_document_incoming_references',
    title: 'Lister references entrantes document qualite',
    description: 'Liste toutes les cibles ALTA qui referencent un document maitre.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.documentation.read',
    requiresConfirmation: false,
    inputSchema: idInputSchema('document_id'),
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'References entrantes du document maitre', data: { references: await qualityMasterDocuments.listIncomingReferences(db, context.store_id, input.document_id || input.id) } }),
  }),
  tool({
    name: 'compare_quality_documents',
    title: 'Comparer documents qualite',
    description: 'Compare deux fiches maitres. Les noms identiques ne declenchent jamais de fusion automatique.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.documentation.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', required: ['first_document_id', 'second_document_id'], properties: { first_document_id: { type: 'string' }, second_document_id: { type: 'string' } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Comparaison documents qualite', data: await qualityMasterDocuments.compareDocuments(db, context.store_id, input.first_document_id, input.second_document_id) }),
  }),
  tool({
    name: 'diagnose_quality_document_duplicates',
    title: 'Diagnostiquer doublons documentaires qualite',
    description: 'Produit un diagnostic lecture seule des doublons exacts et potentiels du referentiel maitre.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.documentation.read',
    requiresConfirmation: false,
    inputSchema: emptyInputSchema,
    execute: async ({ db, context, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Diagnostic doublons documentaires qualite', data: await qualityMasterDocuments.diagnoseDuplicates(db, context.store_id) }),
  }),
  ...['zones', 'equipments', 'temperature_records', 'cleaning_records', 'tasks'].map((kind) => tool({
    name: `get_quality_${kind}`,
    title: `Qualite ${kind.replace(/_/g, ' ')}`,
    description: `Lit les donnees qualite ${kind.replace(/_/g, ' ')} via le contexte metier ALTA.`,
    domain: 'quality',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 200 } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => {
      const data = await qualityContext.getQualityContext(db, context.store_id, input);
      return response({ tool: currentTool.name, domain: currentTool.domain, summary: `Donnees qualite ${kind}`, data: { [kind]: data[kind] || [] }, source_freshness: data.source_freshness });
    },
  })),
  tool({
    name: 'export_quality_documentation_preview',
    title: 'Apercu export qualite',
    description: 'Prepare les donnees d export qualite sans produire de PDF persistant.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.documentation.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: { collection_id: { type: 'string' } }, additionalProperties: true },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Apercu export qualite', data: await qualityDocumentation.getDocumentation(db, context.store_id, input.collection_id) }),
  }),
  tool({
    name: 'export_quality_documentation_pdf',
    title: 'Exporter PDF qualite persistant',
    description: 'Genere le Manuel Qualite complet avec le moteur PDF persistant existant et retourne l export cree sans embarquer le PDF brut.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.COMMITTING_ACTION,
    requiredPermission: 'quality.document.export',
    requiresConfirmation: true,
    inputSchema: qualityDocumentationExportInputSchema,
    execute: async ({ db, context, input, tool: currentTool }) => {
      const exported = await qualityExport.exportDocumentationPdf(db, context.store_id, input.collection_id, context.user_id, {
        export_type: input.export_type || 'full',
        profile: input.profile || (input.export_type === 'ddpp' ? 'ddpp' : null),
        tome_id: input.tome_id || null,
        only_validated: input.only_validated === true,
        include_missing: input.include_missing !== false,
        include_attachments: input.include_attachments !== false,
        include_master_annexes: (input.profile === 'ddpp' || input.export_type === 'ddpp') ? input.include_master_annexes !== false : input.include_master_annexes === true,
        include_external_master_documents: (input.profile === 'ddpp' || input.export_type === 'ddpp') ? input.include_external_master_documents !== false : input.include_external_master_documents === true,
        include_enr_examples: (input.profile === 'ddpp' || input.export_type === 'ddpp') ? input.include_enr_examples !== false : input.include_enr_examples === true,
      });
      if (!exported) {
        const error = new Error('Dossier documentaire introuvable');
        error.status = 404;
        error.expose = true;
        throw error;
      }
      return response({
        tool: currentTool.name,
        domain: currentTool.domain,
        summary: 'Export PDF qualite genere',
        data: {
          export_id: exported.id,
          filename: exported.filename,
          generated_at: exported.generated_at,
          download_url: `/api/quality/documentation/exports/${exported.id}/download`,
          export_summary: exported.export_summary,
        },
      });
    },
  }),
  tool({
    name: 'list_agent_audit_logs',
    title: 'Journal audit agent',
    description: 'Liste les executions d outils agent du magasin courant.',
    domain: 'agent_audit',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'admin.agent.audit.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 200 } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Journal audit agent', data: { logs: await listAgentAuditLogs(db, context.store_id, input) } }),
  }),
  tool({
    name: 'get_agent_audit_log',
    title: 'Detail audit agent',
    description: 'Lit le detail masque d une execution d outil agent.',
    domain: 'agent_audit',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'admin.agent.audit.read',
    requiresConfirmation: false,
    inputSchema: idInputSchema('id'),
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Detail audit agent', data: { log: await getAgentAuditLog(db, context.store_id, input) } }),
  }),
];

const plannedToolNames = [
  ['clients', 'get_client_profile', 'clients.read', RISK_LEVELS.READ],
  ['clients', 'create_or_update_client', 'clients.write', RISK_LEVELS.LOW_REVERSIBLE_WRITE],
  ['suppliers', 'get_supplier_profile', 'suppliers.read', RISK_LEVELS.READ],
  ['suppliers', 'prepare_supplier_order', 'suppliers.write', RISK_LEVELS.COMMITTING_ACTION],
  ['articles', 'get_article_profile', 'articles.read', RISK_LEVELS.READ],
  ['articles', 'update_article_price', 'articles.write', RISK_LEVELS.COMMITTING_ACTION],
  ['stock', 'prepare_stock_regularization', 'stock.write', RISK_LEVELS.COMMITTING_ACTION],
  ['purchases', 'prepare_purchase', 'purchases.write', RISK_LEVELS.COMMITTING_ACTION],
  ['purchases', 'confirm_reception', 'purchases.write', RISK_LEVELS.COMMITTING_ACTION],
  ['sales', 'prepare_customer_order', 'sales.write', RISK_LEVELS.COMMITTING_ACTION],
  ['sales', 'validate_delivery_note', 'sales.write', RISK_LEVELS.COMMITTING_ACTION],
  ['sales', 'generate_customer_invoice', 'sales.write', RISK_LEVELS.COMMITTING_ACTION],
  ['communications', 'prepare_email_draft', 'communications.read', RISK_LEVELS.READ],
  ['communications', 'preview_email', 'communications.read', RISK_LEVELS.READ],
  ['communications', 'send_email_confirmed', 'communications.send', RISK_LEVELS.COMMITTING_ACTION],
  ['communications', 'prepare_whatsapp_message', 'communications.read', RISK_LEVELS.READ],
  ['communications', 'prepare_sms_message', 'communications.read', RISK_LEVELS.READ],
  ['communications', 'preview_customer_price_list', 'communications.read', RISK_LEVELS.READ],
  ['communications', 'send_customer_price_list_confirmed', 'communications.send', RISK_LEVELS.COMMITTING_ACTION],
  ['statistics', 'analyze_business_performance', 'statistics.read', RISK_LEVELS.READ],
  ['cashflow', 'get_supplier_exposure', 'cashflow.read', RISK_LEVELS.READ],
  ['cashflow', 'get_manual_cashflow_items', 'cashflow.read', RISK_LEVELS.READ],
  ['cashflow', 'get_distrimer_exposure', 'cashflow.read', RISK_LEVELS.READ],
  ['cashflow', 'run_cashflow_scenario', 'cashflow.read', RISK_LEVELS.READ],
  ['cashflow', 'compare_cashflow_scenarios', 'cashflow.read', RISK_LEVELS.READ],
  ['cashflow', 'identify_cashflow_risks', 'cashflow.read', RISK_LEVELS.READ],
  ['cashflow', 'export_cashflow_forecast', 'cashflow.read', RISK_LEVELS.READ],
  ['pennylane', 'get_pennylane_sync_status', 'pennylane.read', RISK_LEVELS.READ],
  ['pennylane', 'prepare_pennylane_sync', 'pennylane.sync', RISK_LEVELS.COMMITTING_ACTION],
  ['employee_planning', 'get_employee_planning', 'employee_planning.read', RISK_LEVELS.READ],
  ['employee_planning', 'prepare_employee_absence', 'employee_planning.write', RISK_LEVELS.COMMITTING_ACTION],
  ['transformations', 'get_transformations', 'transformations.read', RISK_LEVELS.READ],
  ['transformations', 'prepare_transformation', 'transformations.write', RISK_LEVELS.COMMITTING_ACTION],
  ['quality', 'list_quality_zones', 'quality.read', RISK_LEVELS.READ],
  ['quality', 'record_temperature_reading', 'quality.write', RISK_LEVELS.LOW_REVERSIBLE_WRITE],
  ['quality_documentation', 'analyze_quality_documentation_completeness', 'quality.documentation.read', RISK_LEVELS.READ],
  ['quality_documentation', 'identify_quality_documentation_gaps', 'quality.documentation.read', RISK_LEVELS.READ],
  ['quality_documentation', 'merge_quality_sections', 'quality.documentation.edit', RISK_LEVELS.COMMITTING_ACTION],
  ['quality_documentation', 'create_quality_missing_item', 'quality.documentation.edit', RISK_LEVELS.LOW_REVERSIBLE_WRITE],
  ['quality_documentation', 'update_quality_missing_item', 'quality.documentation.edit', RISK_LEVELS.LOW_REVERSIBLE_WRITE],
  ['quality_documentation', 'create_quality_section_table', 'quality.documentation.edit', RISK_LEVELS.LOW_REVERSIBLE_WRITE],
  ['quality_documentation', 'update_quality_section_table', 'quality.documentation.edit', RISK_LEVELS.LOW_REVERSIBLE_WRITE],
  ['quality_documentation', 'create_quality_section_diagram', 'quality.documentation.edit', RISK_LEVELS.LOW_REVERSIBLE_WRITE],
  ['quality_documentation', 'update_quality_section_diagram', 'quality.documentation.edit', RISK_LEVELS.LOW_REVERSIBLE_WRITE],
  ['quality_documentation', 'list_quality_attachments', 'quality.documentation.read', RISK_LEVELS.READ],
  ['quality_documentation', 'export_quality_documentation_pdf', 'quality.documentation.read', RISK_LEVELS.READ],
];

for (const [domain, name, permission, riskLevel] of plannedToolNames) {
  if (tools.some((item) => item.name === name)) continue;
  tools.push(tool({
    name,
    title: name.replace(/_/g, ' '),
    description: 'Contrat outil agent reference dans le catalogue. Execution directe non activee tant que le service metier explicite n est pas raccorde.',
    domain,
    enabled: false,
    status: 'planned',
    riskLevel,
    requiredPermission: permission,
    requiresConfirmation: riskLevel >= RISK_LEVELS.COMMITTING_ACTION,
    inputSchema: { type: 'object', additionalProperties: true },
    execute: async ({ tool: currentTool }) => response({
      tool: currentTool.name,
      domain: currentTool.domain,
      summary: 'Outil declare, execution non activee',
      data: { available: false, status: 'planned' },
      warnings: ['Aucun SQL libre ni appel route generique n est disponible pour cet outil.'],
    }),
  }));
}

function listAgentTools() {
  return tools.map(({ execute, ...metadata }) => ({ ...metadata }));
}

function getAgentTool(name) {
  return tools.find((item) => item.name === name) || null;
}

function listMcpTools() {
  return listAgentTools().filter((item) => item.enabled !== false && item.status !== 'planned').map((item) => ({
    name: item.name,
    title: item.title,
    description: item.description,
    inputSchema: item.inputSchema,
    outputSchema: item.outputSchema,
    annotations: {
      readOnlyHint: item.riskLevel === RISK_LEVELS.READ,
      destructiveHint: item.riskLevel === RISK_LEVELS.CRITICAL_DESTRUCTIVE,
      openWorldHint: false,
    },
    _meta: {
      riskLevel: item.riskLevel,
      domain: item.domain,
      requiredPermission: item.requiredPermission,
      requiredPermissions: item.requiredPermissions || (item.requiredPermission ? [item.requiredPermission] : []),
      requiresConfirmation: item.requiresConfirmation,
    },
  }));
}

module.exports = {
  RISK_LEVELS,
  listAgentTools,
  getAgentTool,
  listMcpTools,
};
