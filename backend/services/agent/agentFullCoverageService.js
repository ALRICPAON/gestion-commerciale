const { buildFrontendBackendCoverage } = require('./agentFrontendBackendCoverageService');

const FINAL_AGENT_PERMISSIONS = Object.freeze([
  'mcp.execute',
  'agent.use',
  'clients.read',
  'clients.write',
  'suppliers.read',
  'suppliers.write',
  'articles.read',
  'articles.write',
  'stock.read',
  'stock.write',
  'purchases.read',
  'purchases.write',
  'sales.read',
  'sales.write',
  'communications.read',
  'communications.send',
  'call_sheet.read',
  'call_sheet.write',
  'statistics.read',
  'cashflow.read',
  'cashflow.write',
  'pennylane.read',
  'pennylane.sync',
  'employee_planning.read',
  'employee_planning.write',
  'transformations.read',
  'transformations.write',
  'quality.read',
  'quality.record.create',
  'quality.nc.manage',
  'quality.action.manage',
  'quality.configuration.write',
  'quality.documentation.read',
  'quality.documentation.edit',
  'supplies_materials.read',
  'supplies_materials.write',
  'supplies_materials.archive',
  'supplies_materials.documents',
]);

const MODULE_COVERAGE = Object.freeze([
  { domain: 'clients', read: ['search_clients', 'get_clients_overview', 'get_client_profile'], create: ['prepare_client_draft'], update: ['prepare_client_update'], prepare: ['prepare_customer_price_list'], execute: [] },
  { domain: 'suppliers', read: ['search_suppliers', 'get_suppliers_overview', 'get_supplier_profile'], create: ['prepare_supplier_draft'], update: ['prepare_supplier_update', 'prepare_supplier_article_mapping'], prepare: ['prepare_supplier_order'], execute: [] },
  { domain: 'articles', read: ['search_articles', 'get_articles_overview', 'get_article_profile'], create: ['prepare_article_draft'], update: ['prepare_article_update', 'prepare_article_price_update'], prepare: [], execute: ['execute_pending_action'] },
  { domain: 'stock', read: ['search_stock', 'get_stock_overview', 'get_stock_state', 'get_stock_lots', 'get_stock_movements'], create: [], update: ['prepare_lot_update'], prepare: ['prepare_stock_regularization', 'prepare_traceability_action'], execute: [] },
  { domain: 'purchases', read: ['get_purchases_overview', 'get_purchase_profile'], create: ['prepare_purchase'], update: ['prepare_purchase_update', 'prepare_purchase_reception'], prepare: ['prepare_supplier_invoice_matching'], execute: [] },
  { domain: 'sales', read: ['search_sales', 'get_sales_overview', 'get_sale_profile'], create: ['prepare_customer_order'], update: ['prepare_sales_document_update'], prepare: ['prepare_delivery_note', 'prepare_customer_invoice', 'prepare_customer_credit_note'], execute: ['execute_pending_action', 'execute_business_action', 'create_customer_order_confirmed', 'convert_order_to_delivery_note'] },
  { domain: 'communications', read: ['get_communications_overview'], create: ['prepare_email_draft', 'prepare_whatsapp_message', 'prepare_sms_message'], update: [], prepare: ['preview_email', 'preview_customer_price_list', 'prepare_product_recall_notifications'], execute: ['send_email_confirmed', 'send_customer_price_list_confirmed', 'execute_pending_action'] },
  { domain: 'call_sheet', read: ['list_call_sheets', 'get_call_sheet', 'search_call_sheet_lines'], create: [], update: [], prepare: ['prepare_call_sheet_add_line', 'prepare_call_sheet_update_line', 'prepare_call_sheet_delete_line'], execute: ['execute_pending_action'] },
  { domain: 'statistics', read: ['analyze_business_performance'], create: [], update: [], prepare: [], execute: [] },
  { domain: 'cashflow', read: ['get_cashflow_dashboard', 'get_cashflow_forecast', 'get_cashflow_data_sources', 'get_customer_receivables', 'get_supplier_payables', 'get_bank_balances', 'get_distrimer_exposure'], create: ['prepare_cashflow_manual_item'], update: ['prepare_cashflow_settings_update'], prepare: ['prepare_cashflow_plan', 'run_cashflow_scenario'], execute: [] },
  { domain: 'pennylane', read: ['get_pennylane_sync_status', 'get_pennylane_diagnostics'], create: [], update: ['prepare_pennylane_mapping_update'], prepare: ['prepare_pennylane_sync'], execute: [] },
  { domain: 'employee_planning', read: ['get_employee_planning', 'get_employee_profile'], create: ['prepare_employee_draft', 'prepare_employee_absence'], update: ['prepare_employee_planning_update'], prepare: ['prepare_employee_manager_validation'], execute: [] },
  { domain: 'transformations', read: ['get_transformations', 'get_transformation_profile'], create: ['prepare_transformation'], update: ['prepare_transformation_update'], prepare: ['prepare_transformation_validation'], execute: [] },
  { domain: 'quality', read: ['get_quality_context', 'get_quality_today_work', 'get_quality_overdue_work', 'get_quality_ddpp_dashboard', 'get_quality_ddpp_record_detail', 'get_quality_zones', 'get_quality_equipments', 'get_quality_temperature_records', 'get_quality_cleaning_records', 'get_quality_tasks', 'list_quality_temperature_types', 'list_quality_temperature_parameters', 'get_quality_temperature_parameter', 'list_quality_cleaning_plans', 'get_quality_cleaning_plan', 'list_quality_evidence_records', 'get_quality_evidence_record', 'list_quality_events', 'get_quality_event', 'list_quality_blocked_lots', 'get_lot_quality_status', 'search_traceability_lots', 'get_traceability_snapshot', 'list_traceability_tests', 'get_traceability_test', 'list_product_recall_campaigns', 'get_product_recall_campaign', 'analyze_product_recall_for_lot'], create: ['quality_create_task', 'quality_create_cleaning_plan', 'create_quality_temperature_parameter', 'create_quality_cleaning_plan', 'create_quality_non_conformity', 'create_quality_corrective_action'], update: ['quality_update_task', 'quality_update_cleaning_plan', 'quality_assign_task_to_zone', 'quality_assign_task_to_equipment', 'update_quality_temperature_parameter', 'archive_or_disable_quality_temperature_parameter', 'update_quality_cleaning_plan', 'archive_or_disable_quality_cleaning_plan'], prepare: ['prepare_quality_lot_block', 'prepare_quality_lot_release', 'prepare_traceability_test_completion', 'prepare_product_recall'], execute: ['quality_activate_configuration', 'quality_deactivate_configuration', 'execute_quality_temperature_occurrence', 'execute_quality_cleaning_occurrence', 'execute_quality_manual_occurrence', 'close_quality_non_conformity', 'execute_pending_action'] },
  { domain: 'quality_documentation', read: ['list_quality_documentation', 'get_quality_documentation_outline', 'get_quality_section', 'get_quality_section_blocks', 'search_quality_sections', 'list_quality_missing_items', 'list_quality_master_documents', 'get_quality_master_document', 'list_quality_document_references', 'list_quality_document_incoming_references', 'compare_quality_documents', 'diagnose_quality_document_duplicates'], create: ['create_quality_section', 'quality.documentation.add_text_block', 'quality.documentation.add_table_block', 'quality.documentation.add_diagram_block', 'create_quality_master_document', 'link_existing_attachment_to_master_document', 'add_quality_document_reference'], update: ['quality.documentation.update_text_block', 'quality.documentation.move_block', 'update_quality_missing_item', 'resolve_quality_missing_item', 'reopen_quality_missing_item', 'restore_quality_section_version', 'update_quality_master_document', 'archive_quality_document_reference'], prepare: ['preview_quality_section_update'], execute: ['quality.documentation.apply_section_updates', 'update_quality_section', 'execute_quality_section_update', 'archive_quality_master_document', 'export_quality_documentation_pdf'] },
  { domain: 'supplies_materials', read: ['list_supplies_materials', 'get_supply_material', 'search_supplies_materials', 'list_supply_material_documents', 'list_supply_material_links', 'diagnose_supplies_materials'], create: ['create_supply_material', 'add_supply_material_document_reference', 'add_supply_material_link'], update: ['update_supply_material', 'archive_supply_material_link'], prepare: [], execute: ['archive_supply_material'] },
]);

const SNAPSHOT_QUERIES = Object.freeze({
  purchases: {
    sql: `SELECT id, reference_number, supplier_name, status, purchase_date, total_amount
          FROM purchases
          WHERE store_id = $1
          ORDER BY created_at DESC
          LIMIT $2`,
  },
  communications: {
    sql: `SELECT id, channel, subject, status, created_at
          FROM document_communications
          WHERE store_id = $1
          ORDER BY created_at DESC
          LIMIT $2`,
  },
  pennylane: {
    sql: `SELECT id, resource, status, started_at, completed_at, error_message
          FROM cashflow_sync_logs
          WHERE store_id = $1
          ORDER BY started_at DESC
          LIMIT $2`,
  },
  employee_planning: {
    sql: `SELECT id, week_start, employee_id, status, manager_validated_at, employee_validated_at
          FROM employee_planning_lines
          WHERE store_id = $1
          ORDER BY week_start DESC, created_at DESC
          LIMIT $2`,
  },
  transformations: {
    sql: `SELECT id, reference, status, transformation_date, created_at
          FROM transformations
          WHERE store_id = $1
          ORDER BY created_at DESC
          LIMIT $2`,
  },
  stock_lots: {
    sql: `SELECT id, article_id, lot_code, supplier_lot_number, dlc, qty_remaining
          FROM lots
          WHERE store_id = $1
          ORDER BY COALESCE(dlc, DATE '9999-12-31'), created_at DESC
          LIMIT $2`,
  },
  stock_movements: {
    sql: `SELECT id, article_id, lot_id, movement_type, quantity, source_table, source_id, created_at
          FROM stock_movements
          WHERE store_id = $1
          ORDER BY created_at DESC
          LIMIT $2`,
  },
});

function limit(value, fallback = 50, max = 100) {
  const parsed = Number(value);
  return Math.min(Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback, max);
}

async function safeQuery(db, sql, params) {
  try {
    const result = await db.query(sql, params);
    return { rows: result.rows || [], unavailable: false };
  } catch (error) {
    return { rows: [], unavailable: true, error: error.message };
  }
}

async function getModuleSnapshot(db, storeId, key, input = {}) {
  const query = SNAPSHOT_QUERIES[key];
  if (!query) return { rows: [], unavailable: true, error: `Snapshot non configure: ${key}` };
  const result = await safeQuery(db, query.sql, [storeId, limit(input.limit)]);
  return {
    key,
    count: result.rows.length,
    rows: result.rows,
    unavailable: result.unavailable,
    error: result.error || null,
  };
}

function prepareBusinessAction(context, input = {}, defaults = {}) {
  const actionType = input.action_type || defaults.action_type;
  return {
    action_type: actionType,
    mode: 'prepared_only',
    requires_confirmation: defaults.requires_confirmation !== false,
    required_permissions: defaults.required_permissions || [],
    source: context.source || 'agent',
    store_id: context.store_id,
    summary: input.summary || defaults.summary || `Preparation ${actionType}`,
    impact: input.impact || defaults.impact || 'Aucun effet metier direct: preparation a verifier avant execution.',
    target_objects: input.target_objects || [],
    payload: input.payload || input,
    executable_now: Boolean(defaults.executable_now),
    execution_note: defaults.executable_now
      ? 'Action executable via le mecanisme de confirmation existant.'
      : 'Preparation exposee au MCP; aucune execution metier directe n est raccordee pour cette action.',
  };
}

function buildCoverageReport(publicTools = [], modules = []) {
  const publicNames = new Set(publicTools.map((tool) => tool.name));
  const frontendBackendCoverage = buildFrontendBackendCoverage(publicTools);
  const rows = MODULE_COVERAGE.map((module) => {
    const expected = [
      ...module.read,
      ...module.create,
      ...module.update,
      ...module.prepare,
      ...module.execute,
    ];
    const missing = expected.filter((name) => !publicNames.has(name));
    const moduleInfo = modules.find((item) => item.domain === module.domain) || {};
    return {
      module: module.domain,
      title: moduleInfo.title || module.domain,
      permissions: moduleInfo.permissions || [],
      read_tools: module.read,
      create_tools: module.create,
      update_tools: module.update,
      prepare_tools: module.prepare,
      confirmed_execution_tools: module.execute,
      missing_tools: missing,
      present: missing.length === 0,
    };
  });
  const missingTools = rows.flatMap((row) => row.missing_tools.map((tool) => ({ module: row.module, tool })));
  return {
    coverage_complete: missingTools.length === 0 && frontendBackendCoverage.coverage_complete,
    module_count: rows.length,
    missing_tools: missingTools,
    missing_frontend_backend_capabilities: frontendBackendCoverage.missing_capabilities,
    frontend_backend_coverage_complete: frontendBackendCoverage.coverage_complete,
    frontend_backend_capabilities: frontendBackendCoverage.capabilities,
    final_permissions: [...FINAL_AGENT_PERMISSIONS],
    matrix: rows,
  };
}

module.exports = {
  FINAL_AGENT_PERMISSIONS,
  MODULE_COVERAGE,
  buildCoverageReport,
  getModuleSnapshot,
  prepareBusinessAction,
};
