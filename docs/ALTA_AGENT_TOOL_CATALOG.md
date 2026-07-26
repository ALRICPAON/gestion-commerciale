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
- audit admin: `list_agent_audit_logs`, `get_agent_audit_log`.

Etat actuel:

- 111 outils dans le catalogue administratif.
- 71 outils operationnels exposes au modele via MCP `tools/list`.
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
| `update_quality_section` | quality_documentation | `qualityDocumentationService.updateSection` | operational | 2 | `quality.documentation.edit` | `quality.documentation.edit` | oui | chapitre qualite, versions | n/a | pending action persistante |
| `execute_quality_section_update` | quality_documentation | `qualityDocumentationService.updateSection` | operational | 2 | `quality.documentation.edit` | `quality.documentation.edit` | oui | chapitre qualite, versions | n/a | pending action persistante |

Les outils encore `planned` correspondent aux domaines ou ecritures dont le service metier explicite reste a raccorder sans dupliquer les regles existantes.

Les alias temporaires `quality_section_update`, `update_quality_section` et `versioned_update` sont acceptes uniquement pour compatibilite et sont stockes en base sous le type canonique `quality.documentation.apply_section_updates`.

En `ALTA_AGENT_TRUSTED_MODE=true`, `quality.documentation.apply_section_updates` et `execute_business_action` peuvent executer directement les actions allowlistees sans pending action ni confirmation.

Note MCP: le serveur annonce `tools.listChanged: true` depuis la version `1.6.0`. Le registre d execution est expose depuis `1.7.0`, enrichi en `1.7.1`, et le Trusted Owner Mode est expose en `1.8.0`. Si le client MCP ne consomme pas la notification de changement de catalogue, une reconnexion du client est obligatoire apres deploiement.
