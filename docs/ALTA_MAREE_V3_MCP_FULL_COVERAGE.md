# ALTA_MAREE_V3 - Couverture MCP finale

Version MCP: `1.8.4`

Branche de travail: `feature/alta-v3-full-mcp-coverage`

Permissions techniques recommandees:

```text
ALTA_AGENT_PERMISSIONS=mcp.execute,agent.use,clients.read,clients.write,suppliers.read,suppliers.write,articles.read,articles.write,stock.read,stock.write,purchases.read,purchases.write,sales.read,sales.write,communications.read,communications.send,statistics.read,cashflow.read,cashflow.write,pennylane.read,pennylane.sync,employee_planning.read,employee_planning.write,transformations.read,transformations.write,quality.read,quality.configuration.write,quality.documentation.read,quality.documentation.edit
```

## Verification tools/list

`tools/list` expose maintenant:

- `version`;
- `tool_count`;
- `modules_covered`;
- `coverage_complete`;
- `missing_tools`;
- `final_permissions`;
- `coverage_matrix`.

`coverage_complete: true` est publie uniquement parce que `backend/scripts/test-agent-mcp-coverage-matrix.js` verifie la matrice complete et l'absence de `missing_tools`.

## Matrice fonctionnelle

| Module | Permissions | Lecture MCP | Preparation/ecriture MCP | Execution confirmee | Limites conservees |
|---|---|---|---|---|---|
| Clients | `clients.read`, `clients.write` | `search_clients`, `get_clients_overview`, `get_client_profile` | `prepare_client_draft`, `prepare_client_update`, `prepare_customer_price_list` | aucune execution directe | preparation seulement pour creations/modifications |
| Fournisseurs | `suppliers.read`, `suppliers.write` | `search_suppliers`, `get_suppliers_overview`, `get_supplier_profile` | `prepare_supplier_draft`, `prepare_supplier_update`, `prepare_supplier_article_mapping`, `prepare_supplier_order` | aucune execution directe | pas de creation achat hors action confirmee future |
| Articles/tarifs | `articles.read`, `articles.write` | `search_articles`, `get_articles_overview`, `get_article_profile` | `prepare_article_draft`, `prepare_article_update`, `prepare_article_price_update` | aucune execution directe | pas de mutation prix immediate |
| Stocks/lots/tracabilite | `stock.read`, `stock.write` | `search_stock`, `get_stock_overview`, `get_stock_state`, `get_stock_lots`, `get_stock_movements` | `prepare_lot_update`, `prepare_stock_regularization`, `prepare_traceability_action` | aucune execution directe | pas de suppression physique ni correction d'historique valide |
| Achats/receptions | `purchases.read`, `purchases.write` | `get_purchases_overview`, `get_purchase_profile` | `prepare_purchase`, `prepare_purchase_update`, `prepare_purchase_reception`, `prepare_supplier_invoice_matching` | aucune execution directe | receptions et rapprochements restent prepares/confirmables |
| Ventes | `sales.read`, `sales.write`, `mcp.execute` | `search_sales`, `get_sales_overview`, `get_sale_profile` | `prepare_customer_order`, `prepare_sales_document_update`, `prepare_delivery_note`, `prepare_customer_invoice`, `prepare_customer_credit_note` | `create_customer_order_confirmed`, `convert_order_to_delivery_note`, `execute_pending_action`, `execute_business_action` | confirmation humaine pour actions engageantes |
| Communications | `communications.read`, `communications.send` | `get_communications_overview` | `prepare_email_draft`, `prepare_whatsapp_message`, `prepare_sms_message`, `preview_email`, `preview_customer_price_list` | `send_email_confirmed`, `send_customer_price_list_confirmed` prepare une action confirmee | aucun envoi silencieux |
| Statistiques | `statistics.read` | `analyze_business_performance` | aucune | aucune | lecture/analyse uniquement |
| Tresorerie | `cashflow.read`, `cashflow.write` | dashboards, forecast, sources, creances, dettes, banques, DISTRIMER | `prepare_cashflow_manual_item`, `prepare_cashflow_settings_update`, `prepare_cashflow_plan`, `run_cashflow_scenario` | aucune execution directe | projections via services existants, pas de SQL libre |
| Pennylane | `pennylane.read`, `pennylane.sync` | `get_pennylane_sync_status`, `get_pennylane_diagnostics` | `prepare_pennylane_sync`, `prepare_pennylane_mapping_update` | aucune execution directe | sync preparee et confirmee, pas d'appel arbitraire |
| Planning salarie | `employee_planning.read`, `employee_planning.write` | `get_employee_planning`, `get_employee_profile` | `prepare_employee_draft`, `prepare_employee_absence`, `prepare_employee_planning_update`, `prepare_employee_manager_validation` | aucune execution directe | validation responsable preparee |
| Transformations/negoce | `transformations.read`, `transformations.write` | `get_transformations`, `get_transformation_profile` | `prepare_transformation`, `prepare_transformation_update`, `prepare_transformation_validation` | aucune execution directe | impacts stock non appliques sans raccord metier allowliste |
| Qualite | `quality.read`, `quality.configuration.write` | contexte, zones, equipements, temperatures, nettoyages, taches | `quality_create_task`, `quality_update_task`, `quality_create_cleaning_plan`, `quality_update_cleaning_plan`, affectations zone/equipement | `quality_activate_configuration`, `quality_deactivate_configuration` | activation exige confirmation; plans incomplets refuses |
| Dossier d'agrement sanitaire | `quality.documentation.read`, `quality.documentation.edit`, `mcp.execute` | liste, plan, section, blocs, recherche | creation/modification sections et blocs structures, preview, restauration | `quality.documentation.apply_section_updates`, `update_quality_section`, `execute_quality_section_update` | action canonique allowlistee et auditee |

## Garde-fous

- Aucun outil `execute_sql`, `call_any_route`, `delete_anything`, `update_any_table` ou suppression physique generale n'est expose.
- Les outils `planned` ne sont pas envoyes au modele MCP.
- Les actions allowlistees passent par permissions utilisateur + permissions agent.
- Les executions metier exigent `mcp.execute` et la permission metier cible.
- Les actions engageantes non trusted passent par confirmation humaine ou pending action.
- Les outils de preparation retournent un `prepared_action` sans effet metier direct quand le service d'ecriture canonique n'est pas encore expose.

## Tests

Commandes de verification locale:

```bash
node --check backend/services/agent/agentToolRegistry.js
node --check backend/routes/mcpServer.js
node --check backend/services/agent/agentFullCoverageService.js
node --check backend/routes/agentActions.js
node backend/scripts/test-agent-tool-registry.js
node backend/scripts/test-agent-permissions-context.js
node backend/scripts/test-quality-agent-configuration-tools.js
node backend/scripts/test-quality-router-startup.js
node backend/scripts/test-mcp-public-tools-list.js
node backend/scripts/test-agent-mcp-coverage-matrix.js
```
