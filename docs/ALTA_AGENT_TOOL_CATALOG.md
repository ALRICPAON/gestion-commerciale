# Catalogue outils Agent ALTA

Le catalogue administratif complet est fourni par:

```bash
node backend/scripts/test-agent-tool-registry.js
node backend/scripts/audit-agent-mcp-tools.js
```

Chaque outil declare:

- nom, titre, description;
- domaine;
- niveau de risque 0 a 3;
- permission requise;
- confirmation requise ou non;
- schema d entree;
- schema de sortie;
- etat executable ou contrat `planned`.

Outils raccordes dans ce socle:

- navigation: `list_available_modules`, `get_module_capabilities`, `get_module_help`, `find_feature_in_alta`, `get_user_permissions`, `explain_current_screen`;
- lecture commerciale: `search_clients`, `search_articles`, `search_stock`, `search_suppliers`, `search_sales`;
- actions differees/directes: `create_pending_action`, `execute_pending_action`, `execute_business_action`;
- registre execution: `list_executable_actions`;
- tresorerie: `get_cashflow_dashboard`, `get_cashflow_forecast`, `get_customer_receivables`, `get_supplier_payables`, `get_bank_accounts_summary`, `get_bank_transactions`, `get_recurring_charges`, `get_cashflow_settings`, `simulate_distrimer_payment`, `prepare_cashflow_plan`;
- dossier qualite: `list_quality_documentation`, `get_quality_documentation_outline`, `get_quality_section`, `search_quality_sections`, `list_quality_missing_items`, `get_quality_section_versions`, `draft_quality_section_content`, `preview_quality_section_update`, `update_quality_section`, `create_quality_section`, `restore_quality_section_version`, `list_quality_section_tables`, `list_quality_section_diagrams`, `export_quality_documentation_preview`;
- referentiel documentaire maitre: `list_quality_master_documents`, `get_quality_master_document`, `create_quality_master_document`, `update_quality_master_document`, `archive_quality_master_document`, `link_existing_attachment_to_master_document`, `add_quality_document_reference`, `archive_quality_document_reference`, `list_quality_document_references`, `list_quality_document_incoming_references`, `compare_quality_documents`, `diagnose_quality_document_duplicates`;
- configuration qualite: `quality_create_task`, `quality_update_task`, `quality_create_cleaning_plan`, `quality_update_cleaning_plan`, `quality_assign_task_to_zone`, `quality_assign_task_to_equipment`, `quality_activate_configuration`, `quality_deactivate_configuration`;
- poste qualite operationnel: `get_quality_today_work`, `get_quality_overdue_work`, `get_quality_ddpp_dashboard`, `get_quality_ddpp_record_detail`, `execute_quality_temperature_occurrence`, `execute_quality_cleaning_occurrence`, `execute_quality_manual_occurrence`, `create_quality_non_conformity`, `create_quality_corrective_action`, `close_quality_non_conformity`;
- audit admin: `list_agent_audit_logs`, `get_agent_audit_log`.

Etat actuel:

- 181 outils dans le catalogue administratif.
- 161 outils operationnels dans `agentToolRegistry.listMcpTools`.
- 181 outils publics exposes par la route MCP `tools/list` apres ajout des wrappers compatibles ChatGPT et des outils legacy non dupliques.
- `tools/list` expose `coverage_complete: true`, `missing_tools: []`, `frontend_backend_coverage_complete: true`, `missing_frontend_backend_capabilities: []`, `final_permissions`, `coverage_matrix` et `frontend_backend_capabilities` pour ALTA_MAREE_V3.
- Les outils `planned` restent documentes mais ne sont pas envoyes au modele et sont refuses a l execution.

## Architecture execution MCP

Les actions d ecriture suivent trois niveaux:

- lecture: outils `riskLevel=0`;
- preparation / apercu: `create_pending_action`, previews et brouillons sans effet metier definitif;
- execution: `execute_pending_action` sur une action allowlistee par `agentExecutableActionRegistry`.

Une execution exige:

- une pending action precise et non expiree;
- une confirmation explicite `confirmation=human_confirmed`;
- un payload fige avec empreinte SHA-256;
- la permission `mcp.execute`;
- la permission metier de l action, par exemple `quality.documentation.edit`;
- le service metier backend declare dans la allowlist.

Le registre central des actions executables est visible via `list_executable_actions`.

Actions allowlistees initiales:

| Action | Module | Permission | Service metier | Confirmation | Reversible | Apercu obligatoire | Lot |
|---|---|---|---|---|---:|---:|---:|
| `quality.documentation.apply_section_updates` | quality_documentation | `quality.documentation.edit` + `mcp.execute` | `qualityDocumentationService.updateSection` | explicite | oui | oui | oui |
| `sales.create_customer_order` | sales | `sales.write` + `mcp.execute` | `agentCommercialToolsService.createCustomerOrderConfirmed` | explicite | non | oui | non |
| `sales.convert_order_to_delivery_note` | sales | `sales.write` + `mcp.execute` | `agentCommercialToolsService.convertOrderToDeliveryNote` | explicite | non | oui | non |

Les actions non presentes dans cette allowlist sont refusees. Aucune fonction backend arbitraire ne peut etre appelee par nom.

## Outils devenus operationnels dans ce correctif

| Nom | Domaine | Service metier appele | Statut | Risque | Permission utilisateur | Permission agent | Confirmation | Sources principales | Pagination | Limites |
|---|---|---|---|---:|---|---|---:|---|---|---|
| `prepare_cashflow_plan` | cashflow | `cashflow.buildCashflowProjection` | operational | 0 | `cashflow.read` | `cashflow.read` | non | `sales_documents`, `pennylane_supplier_invoices`, `cashflow_bank_accounts`, `cashflow_manual_forecast_items`, `cashflow_recurring_charges` | details limites dans le service | depend des synchronisations disponibles |
| `get_cashflow_data_sources` | cashflow | `cashflow.getCashflowDataSources` | operational | 0 | `cashflow.read` | `cashflow.read` | non | logs cashflow, Pennylane, banque, ALTA | n/a | dates null si source absente |
| `get_customer_payment_schedule` | cashflow | `cashflow.buildCashflowProjection` | operational | 0 | `cashflow.read` | `cashflow.read` | non | factures clients ALTA/Pennylane | limite par projection | estimation si historique incomplet |
| `get_supplier_payment_schedule` | cashflow | `cashflow.buildCashflowProjection` | operational | 0 | `cashflow.read` | `cashflow.read` | non | factures fournisseurs Pennylane | limite par projection | factures en review signalees |
| `get_bank_balances` | cashflow | `cashflow.listBankAccounts` | operational | 0 | `cashflow.read` | `cashflow.read` | non | `cashflow_bank_accounts` | n/a | solde stale signale ailleurs |
| `get_open_customer_invoices` | cashflow | `cashflow.listCustomerReceivables` | operational | 0 | `cashflow.read` | `cashflow.read` | non | `sales_documents` | max service | aucune ecriture |
| `get_open_supplier_invoices` | cashflow | `cashflow.listSupplierPayables` | operational | 0 | `cashflow.read` | `cashflow.read` | non | `pennylane_supplier_invoices` | max service | depend Pennylane |
| `get_unbilled_sales` | cashflow | `cashflow.listUnbilledSales` | operational | 0 | `cashflow.read` | `cashflow.read` | non | commandes/BL ALTA | `limit` | estimation dates |
| `identify_cashflow_risks` | cashflow | `cashflow.identifyCashflowRisks` | operational | 0 | `cashflow.read` | `cashflow.read` | non | forecast, banque, DISTRIMER, charges | n/a | alertes selon donnees disponibles |
| `compare_cashflow_scenarios` | cashflow | `cashflow.compareCashflowScenarios` | operational | 0 | `cashflow.read` | `cashflow.read` | non | forecast service | n/a | scenarios 7/30/60/90 jours |
| `get_distrimer_exposure` | cashflow | `cashflow.getDistrimer` | operational | 0 | `cashflow.read` | `cashflow.read` | non | factures fournisseurs Pennylane, settings | n/a | limite configurable, defaut 10000 |
| `draft_quality_section` | quality_documentation | `agentQualityContextService.draftQualitySection` | operational | 0 | `quality.documentation.read` | `quality.documentation.read` | non | documentation, blocs, tableaux, diagrammes, qualite | limite contexte 80 | brouillon sans enregistrement |
| `get_quality_context` | quality | `agentQualityContextService.getQualityContext` | operational | 0 | `quality.read` | `quality.read` | non | zones, equipements, temperatures, nettoyage, taches, documents | `limit` max 200 | lecture uniquement |
| `get_quality_section_blocks` | quality_documentation | `agentQualityContextService.getQualitySectionContext` | operational | 0 | `quality.documentation.read` | `quality.documentation.read` | non | `quality_document_blocks` | n/a | lecture uniquement |
| `get_quality_section_attachments` | quality_documentation | `agentQualityContextService.getQualitySectionContext` | operational | 0 | `quality.documentation.read` | `quality.documentation.read` | non | pieces jointes documentation, documents, photos | n/a | ne renvoie pas de secret |
| `prepare_quality_section_update` | quality_documentation | `agentQualityContextService.previewQualitySectionUpdate` | operational | 0 | `quality.documentation.read` | `quality.documentation.read` | non | chapitre qualite | n/a | prepare seulement |
| `update_quality_section` | quality_documentation | `quality.documentation.apply_section_updates` via orchestrateur | operational | 2 | `quality.documentation.edit` | `quality.documentation.edit` | oui | chapitre qualite, versions | n/a | compatibilite, redirige vers action canonique |
| `execute_quality_section_update` | quality_documentation | `quality.documentation.apply_section_updates` via orchestrateur | operational | 2 | `quality.documentation.edit` | `quality.documentation.edit` | oui | chapitre qualite, versions | n/a | compatibilite, redirige vers action canonique |
| `quality_create_task` | quality | `quality/agentConfiguration.createTask` | operational | 1 | `quality.configuration.write` | `quality.configuration.write` | non | `quality_tasks`, `quality_zones`, `quality_equipments`, `stores` | n/a | cree une tache `MANUAL` en `pending_review`, inactive par defaut |
| `quality_update_task` | quality | `quality/agentConfiguration.updateTask` | operational | 1 | `quality.configuration.write` | `quality.configuration.write` | non | `quality_tasks`, `quality_task_history`, zones/equipements | n/a | refuse tache completee, avec historique ou `SYSTEM` verrouillee par une source ALTA |
| `quality_create_cleaning_plan` | quality | `quality/agentConfiguration.createCleaningPlan` | operational | 1 | `quality.configuration.write` | `quality.configuration.write` | non | `quality_cleaning_plans`, `quality_cleaning_plan_zones`, `quality_cleaning_plan_equipments`, `quality_tasks` | n/a | plan source PMS; cree/synchronise automatiquement la tache liee |
| `quality_update_cleaning_plan` | quality | `quality/agentConfiguration.updateCleaningPlan` | operational | 1 | `quality.configuration.write` | `quality.configuration.write` | non | `quality_cleaning_plans`, `quality_cleaning_plan_zones`, `quality_cleaning_plan_equipments`, `quality_tasks` | n/a | synchronise la tache depuis les champs du plan |
| `quality_assign_task_to_zone` | quality | `quality/agentConfiguration.assignTaskToTarget` | operational | 1 | `quality.configuration.write` | `quality.configuration.write` | non | `quality_tasks`, `quality_zones` | n/a | refuse association inter-magasins |
| `quality_assign_task_to_equipment` | quality | `quality/agentConfiguration.assignTaskToTarget` | operational | 1 | `quality.configuration.write` | `quality.configuration.write` | non | `quality_tasks`, `quality_equipments` | n/a | refuse equipement inexistant/autre magasin |
| `list_quality_temperature_types` | quality | `quality/temperatures.listTemperatureTypes` | operational | 0 | `quality.read` | `quality.read` | non | `quality_temperature_types` | n/a | reference active des `type_code` autorises avant creation/modification |
| `list_quality_temperature_parameters` | quality | `quality/temperatures.listTemperatureLimits` | operational | 0 | `quality.read` | `quality.read` | non | `quality_temperature_limits`, taches, zones/equipements | filtres front | lecture parametres |
| `get_quality_temperature_parameter` | quality | `quality/temperatures.getTemperatureLimit` | operational | 0 | `quality.read` | `quality.read` | non | `quality_temperature_limits` | n/a | lecture parametre |
| `create_quality_temperature_parameter` | quality | `quality/temperatures.saveTemperatureLimit` | operational | 1 | `quality.configuration.write` | `quality.configuration.write` | non | `quality_temperature_limits`, `quality_temperature_limit_tasks`, `quality_tasks` | `scheduled_days`, `target_times`, `target_time` legacy | cree/synchronise automatiquement les taches `SYSTEM` par creneau |
| `update_quality_temperature_parameter` | quality | `quality/temperatures.saveTemperatureLimit` | operational | 1 | `quality.configuration.write` | `quality.configuration.write` | non | `quality_temperature_limits`, `quality_temperature_limit_tasks`, `quality_tasks` | `scheduled_days`, `target_times`, `target_time` legacy | synchronise les taches `SYSTEM` liees sans modifier les releves historiques |
| `archive_or_disable_quality_temperature_parameter` | quality | `quality/temperatures.deleteTemperatureLimit` | operational | 1 | `quality.configuration.write` | `quality.configuration.write` | non | `quality_temperature_limits`, `quality_temperature_limit_tasks`, `quality_tasks` | n/a | desactivation logique du parametre et archivage logique des taches liees |
| `list_quality_cleaning_plans` | quality | `quality/cleaning.listCleaningPlans` | operational | 0 | `quality.read` | `quality.read` | non | `quality_cleaning_plans`, `quality_cleaning_plan_zones`, `quality_cleaning_plan_equipments`, taches | filtres front | retourne `zones[]` et `equipments[]`, garde champs legacy |
| `get_quality_cleaning_plan` | quality | `quality/cleaning.getCleaningPlan` | operational | 0 | `quality.read` | `quality.read` | non | `quality_cleaning_plans`, liaisons zones/equipements | n/a | lecture plan multi-cibles |
| `create_quality_cleaning_plan` | quality | `quality/cleaning.saveCleaningPlan` | operational | 1 | `quality.configuration.write` | `quality.configuration.write` | non | `quality_cleaning_plans`, liaisons zones/equipements, `quality_tasks` | n/a | cree la tache liee depuis le plan, sans double saisie |
| `update_quality_cleaning_plan` | quality | `quality/cleaning.saveCleaningPlan` | operational | 1 | `quality.configuration.write` | `quality.configuration.write` | non | `quality_cleaning_plans`, liaisons zones/equipements, `quality_tasks` | n/a | remplace les liaisons et synchronise la tache liee |
| `archive_or_disable_quality_cleaning_plan` | quality | `quality/cleaning.changeCleaningPlanStatus` | operational | 1 | `quality.configuration.write` | `quality.configuration.write` | non | `quality_cleaning_plans` | n/a | desactivation logique uniquement |
| `quality_activate_configuration` | quality | `quality/agentConfiguration.changeConfigurationStatus` | operational | 2 | `quality.configuration.write` | `quality.configuration.write` | oui | `quality_tasks`, `quality_cleaning_plans` | n/a | refuse plan incomplet |
| `quality_deactivate_configuration` | quality | `quality/agentConfiguration.changeConfigurationStatus` | operational | 1 | `quality.configuration.write` | `quality.configuration.write` | non | `quality_tasks`, `quality_cleaning_plans` | n/a | desactivation logique uniquement |
| `get_quality_today_work` | quality | `quality/operations.listQualityTodayWork` | operational | 0 | `quality.read` | `quality.read` | non | taches, temperatures dues, nettoyages dus, occurrences, non-conformites | sections operationnelles | lecture poste du jour |
| `get_quality_overdue_work` | quality | `quality/operations.listQualityTodayWork` | operational | 0 | `quality.read` | `quality.read` | non | taches, temperatures dues, nettoyages dus, occurrences | retards uniquement | lecture retards |
| `get_quality_ddpp_dashboard` | quality | `quality/operations.getDdppDashboard` | operational | 0 | `quality.read` | `quality.read` | non | releves temperature, nettoyages, non-conformites, actions correctives | filtres dates | vue inspection lecture seule |
| `get_quality_ddpp_record_detail` | quality | `quality/operations.getDdppRecordDetail` | operational | 0 | `quality.read` | `quality.read` | non | releve, occurrence, tache, non-conformites, actions correctives | `type`, `id` | detail inspection d un enregistrement |
| `execute_quality_temperature_occurrence` | quality | `quality/operations.executeTemperatureOccurrence` | operational | 1 | `quality.record.create` | `quality.record.create` | non | `quality_temperature_records`, `quality_tasks`, `quality_task_occurrences` | n/a | cree un releve metier avant de completer la tache |
| `execute_quality_cleaning_occurrence` | quality | `quality/operations.executeCleaningOccurrence` | operational | 1 | `quality.record.create` | `quality.record.create` | non | `quality_cleaning_records`, `quality_tasks`, `quality_task_occurrences` | n/a | cree un enregistrement nettoyage avant de completer la tache |
| `execute_quality_manual_occurrence` | quality | `quality/operations.executeManualOccurrence` | operational | 1 | `quality.record.create` | `quality.record.create` | non | `quality_tasks`, `quality_task_occurrences` | n/a | refuse les taches `SYSTEM` verrouillees |
| `create_quality_non_conformity` | quality | `quality/operations.createNonConformity` | operational | 1 | `quality.nc.manage` | `quality.nc.manage` | non | `quality_non_conformities` | n/a | lie origine, tache, occurrence, zone et equipement |
| `create_quality_corrective_action` | quality | `quality/operations.createCorrectiveAction` | operational | 1 | `quality.action.manage` | `quality.action.manage` | non | `quality_corrective_actions` | n/a | rattachee a une non-conformite si fournie |
| `close_quality_non_conformity` | quality | `quality/operations.closeNonConformity` | operational | 2 | `quality.nc.manage` | `quality.nc.manage` | oui | `quality_non_conformities` | n/a | cloture auditee avec confirmation humaine |

Les outils encore `planned` correspondent aux domaines ou ecritures dont le service metier explicite reste a raccorder sans dupliquer les regles existantes.

Les anciens alias d action `quality_section_update`, `update_quality_section`, `versioned_update` et `quality.documentation.create_blocks` sont refuses. Les outils legacy portant un nom proche restent des outils MCP publics distincts quand ils existent, mais les action types executables doivent rester canoniques.

En `ALTA_AGENT_TRUSTED_MODE=true`, `quality.documentation.apply_section_updates` et `execute_business_action` peuvent executer directement les actions allowlistees sans pending action ni confirmation.

Pour les chapitres ayant des blocs structures, `quality_document_blocks` est la source officielle. `content_html` est synchronise comme miroir de compatibilite et fallback legacy. Les actions de blocs allowlistees sont:

- `quality.documentation.update_text_block`;
- `quality.documentation.add_text_block`;
- `quality.documentation.add_table_block`;
- `quality.documentation.add_diagram_block`;
- `quality.documentation.delete_block`;
- `quality.documentation.move_block`.

Ces six operations restent les noms internes canoniques. Pour le connecteur ChatGPT, la route publique MCP expose aussi des noms compatibles sans points, directement appelables et mappes vers les actions internes:

- `quality_documentation_update_text_block` -> `quality.documentation.update_text_block`;
- `quality_documentation_add_text_block` -> `quality.documentation.add_text_block`;
- `quality_documentation_add_table_block` -> `quality.documentation.add_table_block`;
- `quality_documentation_add_diagram_block` -> `quality.documentation.add_diagram_block`;
- `quality_documentation_delete_block` -> `quality.documentation.delete_block`;
- `quality_documentation_move_block` -> `quality.documentation.move_block`.

Ces wrappers sont dans la reponse publique `tools/list`; ils ne sont pas seulement visibles dans `list_executable_actions`, `find_feature_in_alta` ou `get_module_capabilities`.

Note MCP: le serveur annonce `tools.listChanged: true` depuis la version `1.6.0`. Le registre d execution est expose depuis `1.7.0`, enrichi en `1.7.1`, le Trusted Owner Mode est expose en `1.8.0`, les outils MCP publics de blocs qualite sont exposes en `1.8.1`, les wrappers publics compatibles ChatGPT sont exposes en `1.8.2`, les outils de configuration Qualite agent sont exposes en `1.8.3`, et la couverture ALTA_MAREE_V3 complete avec metadonnees `tools/list` est exposee en `1.8.4`. Si le client MCP ne consomme pas la notification de changement de catalogue, une reconnexion du client est obligatoire apres deploiement.
