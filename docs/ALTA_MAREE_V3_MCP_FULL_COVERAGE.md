# ALTA_MAREE_V3 - Couverture MCP finale

Version MCP: `1.8.4`

Branche de travail: `feature/mcp-quality-temperature-types`

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
- `frontend_backend_coverage_complete`;
- `missing_frontend_backend_capabilities`;
- `final_permissions`;
- `coverage_matrix`;
- `frontend_backend_capabilities`.

`coverage_complete: true` est publie uniquement parce que `backend/scripts/test-agent-mcp-coverage-matrix.js` verifie la matrice MCP, la matrice front/backend, l'absence de `missing_tools` et l'absence de `missing_frontend_backend_capabilities`. Le test force aussi l'echec de couverture si `GET /api/quality/temperatures/types` n'est pas expose via `list_quality_temperature_types`.

## Audit front/backend

La matrice `frontend_backend_capabilities` liste, pour chaque capacite auditee:

- fonction disponible dans le front;
- fichier front;
- route backend;
- service metier;
- outil MCP correspondant;
- statut `covered` ou `missing`.

Cette matrice est definie dans `backend/services/agent/agentFrontendBackendCoverageService.js`. Elle couvre tous les modules ALTA et rend obligatoires les capacites front confirmees pour les types temperature, les parametres temperature et les plans de nettoyage.

### Types temperature

Le front charge le referentiel par `QualityTemperatureApi.listTypes()` dans `frontend/quality/js/temperature-api.js`, route `GET /api/quality/temperatures/types`. La route backend appelle `quality/temperatures.listTemperatureTypes`, qui lit `quality_temperature_types` et filtre les lignes actives.

Le MCP expose cette meme source via `list_quality_temperature_types`. Les outils `create_quality_temperature_parameter` et `update_quality_temperature_parameter` valident maintenant `type_code` avec ce service avant toute ecriture dans `quality_temperature_limits`, afin de retourner une erreur metier claire au lieu de laisser echouer la contrainte `quality_temperature_limits.type_code -> quality_temperature_types(code)`.

Codes initiaux du referentiel: `COLD_ROOM`, `WORKSHOP`, `RECEPTION_PRODUCTS`, `SHIPPING`, `VEHICLE`, `LIVE_TANK`, `FREEZER`, `PRODUCT_TEMPERATURE`.

### Plans nettoyage multi-cibles

Les plans de nettoyage restent stockes dans `quality_cleaning_plans`. Les colonnes historiques `zone_id` et `equipment_id` sont conservees pour les API et ecrans existants. Les associations multiples sont portees par:

- `quality_cleaning_plan_zones(plan_id, zone_id)`;
- `quality_cleaning_plan_equipments(plan_id, equipment_id)`.

La migration `064_quality_cleaning_plan_multi_targets.sql` est additive et idempotente. Elle cree les tables de liaison, ajoute les index actifs et backfill les liaisons depuis les colonnes legacy existantes.

Les routes `GET/POST/PUT /api/quality/cleaning/plans` acceptent `zone_ids` et `equipment_ids`, continuent d'accepter `zone_id` et `equipment_id`, et retournent toujours les champs legacy plus `zones: []` et `equipments: []`. Les outils MCP `quality_create_cleaning_plan`, `quality_update_cleaning_plan`, `create_quality_cleaning_plan`, `update_quality_cleaning_plan`, `list_quality_cleaning_plans` et `get_quality_cleaning_plan` utilisent les memes services et exposent ces structures.

Le plan de nettoyage est la source de verite PMS. Ses champs `responsible_user_id`, `frequency_value`, `frequency_unit`, `target_time`, `scheduled_days`, `expected_duration_minutes`, `method`, `expected_proof` et `corrective_action` alimentent automatiquement la `quality_task` liee. La tache sert a l'execution et a l'echeance; elle est creee, mise a jour ou suspendue par le service `quality/cleaning.saveCleaningPlan` et `quality/cleaning.changeCleaningPlanStatus`, sans double saisie.

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
| Qualite | `quality.read`, `quality.configuration.write` | contexte, zones, equipements, types temperature, releves temperature, parametres temperature, releves nettoyage, plans nettoyage, taches | taches, plans nettoyage, parametres temperature, affectations zone/equipement | `quality_activate_configuration`, `quality_deactivate_configuration` | activation exige confirmation; plans incomplets refuses |
| Dossier d'agrement sanitaire | `quality.documentation.read`, `quality.documentation.edit`, `mcp.execute` | liste, plan, section, blocs, recherche | creation/modification sections et blocs structures, preview, restauration | `quality.documentation.apply_section_updates`, `update_quality_section`, `execute_quality_section_update` | action canonique allowlistee et auditee |

## Garde-fous

- Aucun outil `execute_sql`, `call_any_route`, `delete_anything`, `update_any_table` ou suppression physique generale n'est expose.
- Les outils `planned` ne sont pas envoyes au modele MCP.
- Les actions allowlistees passent par permissions utilisateur + permissions agent.
- Les executions metier exigent `mcp.execute` et la permission metier cible.
- Les actions engageantes non trusted passent par confirmation humaine ou pending action.
- Les outils de preparation retournent un `prepared_action` sans effet metier direct quand le service d'ecriture canonique n'est pas encore expose.
- Les outils `archive_or_disable_*` font une desactivation logique; ils ne reactiveront pas une configuration.
- L'activation reste centralisee dans `quality_activate_configuration`, action engageante avec confirmation humaine.

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
node backend/scripts/test-quality-temperature-type-mcp-tools.js
node backend/scripts/test-quality-cleaning-plan-multi-targets.js
```
