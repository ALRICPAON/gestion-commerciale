const commercial = require('../agentCommercialToolsService');
const cashflow = require('../cashflow/service');
const qualityDocumentation = require('../quality/qualityDocumentationService');
const qualityVersions = require('../quality/qualityDocumentationVersionService');
const qualityTables = require('../quality/qualityDocumentationTableService');
const qualityDiagrams = require('../quality/qualityDocumentationDiagramService');
const qualityExport = require('../quality/qualityDocumentationExportService');
const qualityContext = require('../quality/agentQualityContextService');
const qualityConfiguration = require('../quality/agentConfiguration');
const qualityTemperatures = require('../quality/temperatures');
const qualityCleaning = require('../quality/cleaning');
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

const QUALITY_BLOCK_ACTIONS_WITH_CHAPTER = new Set([
  'quality.documentation.add_text_block',
  'quality.documentation.add_table_block',
  'quality.documentation.add_diagram_block',
  'quality.documentation.move_block',
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
  snapshotTool({ name: 'get_pennylane_sync_status', title: 'Etat synchronisation Pennylane', domain: 'pennylane', permission: 'pennylane.read', snapshotKey: 'pennylane' }),
  snapshotTool({ name: 'get_pennylane_diagnostics', title: 'Diagnostics Pennylane', domain: 'pennylane', permission: 'pennylane.read', snapshotKey: 'pennylane' }),
  snapshotTool({ name: 'get_employee_planning', title: 'Planning salarie', domain: 'employee_planning', permission: 'employee_planning.read', snapshotKey: 'employee_planning' }),
  snapshotTool({ name: 'get_employee_profile', title: 'Profil salarie', domain: 'employee_planning', permission: 'employee_planning.read', snapshotKey: 'employee_planning' }),
  snapshotTool({ name: 'get_transformations', title: 'Transformations', domain: 'transformations', permission: 'transformations.read', snapshotKey: 'transformations' }),
  snapshotTool({ name: 'get_transformation_profile', title: 'Profil transformation', domain: 'transformations', permission: 'transformations.read', snapshotKey: 'transformations' }),
  snapshotTool({ name: 'get_stock_lots', title: 'Lots stock', domain: 'stock', permission: 'stock.read', snapshotKey: 'stock_lots' }),
  snapshotTool({ name: 'get_stock_movements', title: 'Mouvements stock', domain: 'stock', permission: 'stock.read', snapshotKey: 'stock_movements' }),
  preparationTool({ name: 'prepare_client_draft', title: 'brouillon client', domain: 'clients', permission: 'clients.write' }),
  preparationTool({ name: 'prepare_client_update', title: 'modification client', domain: 'clients', permission: 'clients.write' }),
  preparationTool({ name: 'prepare_customer_price_list', title: 'liste tarifaire client', domain: 'clients', permission: 'clients.write' }),
  preparationTool({ name: 'prepare_supplier_draft', title: 'brouillon fournisseur', domain: 'suppliers', permission: 'suppliers.write' }),
  preparationTool({ name: 'prepare_supplier_update', title: 'modification fournisseur', domain: 'suppliers', permission: 'suppliers.write' }),
  preparationTool({ name: 'prepare_supplier_article_mapping', title: 'mapping article fournisseur', domain: 'suppliers', permission: 'suppliers.write' }),
  preparationTool({ name: 'prepare_supplier_order', title: 'commande fournisseur', domain: 'suppliers', permission: 'suppliers.write' }),
  preparationTool({ name: 'prepare_article_draft', title: 'brouillon article', domain: 'articles', permission: 'articles.write' }),
  preparationTool({ name: 'prepare_article_update', title: 'modification article', domain: 'articles', permission: 'articles.write' }),
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
    description: 'Cree un parametrage temperature natif, avec jours actifs scheduled_days et horaires multiples target_times. ALTA synchronise les taches SYSTEM liees. Appeler list_quality_temperature_types avant pour choisir un type_code valide.',
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
    description: 'Modifie un parametrage temperature natif, ses jours actifs scheduled_days et ses horaires multiples target_times, sans toucher aux releves historiques. ALTA synchronise les taches SYSTEM liees.',
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
