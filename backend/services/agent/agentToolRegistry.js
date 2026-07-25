const commercial = require('../agentCommercialToolsService');
const cashflow = require('../cashflow/service');
const qualityDocumentation = require('../quality/qualityDocumentationService');
const qualityVersions = require('../quality/qualityDocumentationVersionService');
const qualityTables = require('../quality/qualityDocumentationTableService');
const qualityDiagrams = require('../quality/qualityDocumentationDiagramService');
const qualityExport = require('../quality/qualityDocumentationExportService');
const qualityContext = require('../quality/agentQualityContextService');
const { listModules, getModule } = require('./agentModuleCatalog');
const { listAgentAuditLogs, getAgentAuditLog } = require('./agentAuditService');
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
    name: 'create_pending_action',
    title: 'Creer une action en attente',
    description: 'Fige un payload et demande une confirmation humaine avant execution.',
    domain: 'agent_actions',
    riskLevel: RISK_LEVELS.LOW_REVERSIBLE_WRITE,
    requiredPermission: 'agent.use',
    requiresConfirmation: false,
    inputSchema: { type: 'object', required: ['action_type', 'summary', 'payload'], properties: { action_type: { type: 'string' }, summary: { type: 'string' }, payload: { type: 'object' } }, additionalProperties: true },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Action en attente creee', data: await commercial.createPendingAction(db, context.store_id, input) }),
  }),
  tool({
    name: 'execute_pending_action',
    title: 'Executer une action confirmee',
    description: 'Execute exactement le payload fige d une action en attente deja confirmee.',
    domain: 'agent_actions',
    riskLevel: RISK_LEVELS.COMMITTING_ACTION,
    requiredPermission: 'agent.use',
    requiresConfirmation: true,
    inputSchema: { type: 'object', required: ['id', 'confirmation'], properties: { id: { type: 'string' }, confirmation: { type: 'string', enum: ['human_confirmed'] } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Action en attente executee', data: await commercial.executePendingAction(db, context.store_id, input) }),
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
    inputSchema: { type: 'object', properties: { section_id: { type: 'string' }, code: { type: 'string' }, query: { type: 'string' } }, additionalProperties: false },
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
    inputSchema: { type: 'object', properties: { section_id: { type: 'string' }, code: { type: 'string' }, query: { type: 'string' } }, additionalProperties: false },
    execute: async ({ db, context, input, tool: currentTool }) => {
      const data = await qualityContext.getQualitySectionContext(db, context.store_id, input);
      return response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Blocs chapitre qualite', data: { section: data?.section || null, blocks: data?.blocks || [] } });
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
    description: 'Met a jour un chapitre qualite via le service existant avec version et audit.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.COMMITTING_ACTION,
    requiredPermission: 'quality.documentation.edit',
    requiresConfirmation: true,
    inputSchema: { type: 'object', required: ['section_id', 'content_html'], properties: { section_id: { type: 'string' }, content_html: { type: 'string' }, status: { type: 'string' }, comment_internal: { type: 'string' }, pending_action_id: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: true },
    execute: async ({ db, context, input, tool: currentTool }) => {
      const before = await findQualitySection(db, context.store_id, input);
      const section = await qualityDocumentation.updateSection(db, context.store_id, input.section_id, context.user_id, input);
      const versions = section ? await qualityVersions.listSectionVersions(db, context.store_id, section.id) : [];
      return {
        ok: true,
        mode: 'executed',
        tool: currentTool.name,
        domain: currentTool.domain,
        target_type: 'quality_section',
        target_id: section?.id || null,
        version_id: versions[0]?.id || null,
        changes: [{ field: 'content_html', before: before?.content_html || '', after: section?.content_html || '' }],
        warnings: [],
        audit_id: null,
      };
    },
  }),
  tool({
    name: 'prepare_quality_section_update',
    title: 'Preparer modification chapitre qualite',
    description: 'Produit un apercu avant/apres et le payload a confirmer pour une modification qualite.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.READ,
    requiredPermission: 'quality.documentation.read',
    requiresConfirmation: false,
    inputSchema: { type: 'object', properties: { section_id: { type: 'string' }, code: { type: 'string' }, query: { type: 'string' }, content_html: { type: 'string' } }, additionalProperties: true },
    execute: async ({ db, context, input, tool: currentTool }) => {
      const preview = await qualityContext.previewQualitySectionUpdate(db, context.store_id, input);
      return response({ tool: currentTool.name, domain: currentTool.domain, summary: 'Modification qualite preparee', data: { preview, confirmation_tool: 'update_quality_section', payload: { section_id: preview.section_id, content_html: preview.after.content_html } }, missing_information: preview.missing_information });
    },
  }),
  tool({
    name: 'execute_quality_section_update',
    title: 'Executer modification chapitre qualite',
    description: 'Alias confirme de update_quality_section avec payload fige en pending action.',
    domain: 'quality_documentation',
    riskLevel: RISK_LEVELS.COMMITTING_ACTION,
    requiredPermission: 'quality.documentation.edit',
    requiresConfirmation: true,
    inputSchema: { type: 'object', properties: { section_id: { type: 'string' }, content_html: { type: 'string' }, pending_action_id: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: true },
    execute: async ({ db, context, input, tool: currentTool }) => {
      const before = await findQualitySection(db, context.store_id, input);
      const section = await qualityDocumentation.updateSection(db, context.store_id, input.section_id, context.user_id, input);
      const sectionVersions = section ? await qualityVersions.listSectionVersions(db, context.store_id, section.id) : [];
      return {
        ok: true,
        mode: 'executed',
        tool: currentTool.name,
        domain: currentTool.domain,
        target_type: 'quality_section',
        target_id: section?.id || null,
        version_id: sectionVersions[0]?.id || null,
        changes: [{ field: 'content_html', before: before?.content_html || '', after: section?.content_html || '' }],
        warnings: [],
        audit_id: null,
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
