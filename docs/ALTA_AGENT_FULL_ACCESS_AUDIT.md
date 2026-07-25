# Audit acces complet Agent ALTA

Branche: `feature/alta-agent-full-software-access`

Date: 2026-07-25

## Constats structurants

- `backend/server.js` monte 57 routeurs applicatifs sous `/api` et 1 serveur MCP sous `/mcp`.
- Le MCP existant et l assistant interne dupliquaient deja plusieurs definitions d outils.
- Le depot contient deux mecanismes d actions differees: `agent_pending_actions` pour le connecteur agent et `ai_pending_actions` pour l assistant interne.
- Les modules tresorerie et dossier qualite possedent deja des services metier reutilisables; le socle agent les appelle sans SQL libre genere par le modele.
- Aucun outil generique `execute_sql`, `call_any_route`, `delete_anything` ou `update_any_table` n a ete ajoute.

## Classification des routeurs montes

| Domaine | Module | Route actuelle | Service metier utilise | Lecture disponible | Ecriture disponible | Risque | Confirmation requise | Nouvel outil agent prevu | Etat apres developpement | Tests associes |
|---|---|---|---|---:|---:|---|---:|---|---|---|
| Auth | Connexion | `/api/login` | `routes/auth.js` | oui | oui | 3 | oui | aucun outil agent | exclu agent | manuel securite |
| Admin | Utilisateurs | `/api` | `routes/users.js` | oui | oui | 3 | oui | `get_user_permissions` | catalogue | registry |
| Parametres | Magasin | `/api` | `routes/storeSettings.js` | oui | oui | 2 | oui | planned | declare non executable | registry |
| Parametres | Branding | `/api` | `routes/storeBranding.js` | oui | oui | 2 | oui | planned | declare non executable | registry |
| Communications | Email/WhatsApp | `/api` | `routes/communication.js` | oui | oui | 2 | oui | `prepare_email_draft`, `send_email_confirmed` | contrat declare | registry |
| Articles | Niveau magasin | `/api/articles` | `articlesStoreLevelRoutes` | oui | oui | 2 | oui | `search_articles`, `get_article_profile` | lecture raccordee | registry |
| Articles | Import Excel | `/api/articles` | `articlesExcelRoutes` | oui | oui | 2 | oui | `prepare_article_import` | a completer | audit |
| Articles | Detail Excel | `/api/articles` | `articlesExcelDetailRoutes` | oui | oui | 1 | selon payload | planned | a completer | audit |
| Articles | Catalogue | `/api/articles` | `routes/articles.js` | oui | oui | 2 | oui | `search_articles`, `update_article_price` | lecture raccordee | registry |
| Fournisseurs | Fiches | `/api` | `routes/suppliers.js` | oui | oui | 2 | oui | `search_suppliers`, `get_supplier_profile` | lecture raccordee | registry |
| Fournisseurs | Contacts | `/api` | `routes/supplierContacts.js` | oui | oui | 1 | non/selon role | planned | declare | audit |
| Clients | Fiches | `/api` | `routes/clients.js` | oui | oui | 2 | oui | `search_clients`, `get_client_profile` | lecture raccordee | registry |
| Clients | Contacts | `/api` | `routes/clientContacts.js` | oui | oui | 1 | non/selon role | planned | declare | audit |
| Ventes | Factures clients | `/api` | `routes/customerInvoices.js` | oui | oui | 2 | oui | `generate_customer_invoice` | contrat declare | registry |
| Ventes | Avoirs clients | `/api` | `routes/customerCreditNotes.js` | oui | oui | 2 | oui | planned | declare | audit |
| Documents | PDF | `/api` | `routes/pdfDocuments.js` | oui | non | 0 | non | exports planned | declare | audit |
| Communications | Mercuriales email | `/api/customer-price-lists/email` | `customerTariffEmailsRoutes` | oui | oui | 2 | oui | `send_customer_price_list_confirmed` | contrat declare | registry |
| Communications | Mercuriales | `/api/customer-price-lists` | `customerPriceListsRoutes` | oui | oui | 1 | selon envoi | `preview_customer_price_list` | contrat declare | registry |
| Ventes | Fiche appel | `/api` | `quickOrderSheetsRoutes` | oui | oui | 1 | non/selon role | planned | declare | audit |
| Achats | Reception upgrade | `/api` | `purchaseReceptionUpgradeRoutes` | oui | oui | 2 | oui | `confirm_reception` | contrat declare | registry |
| Fournisseurs | Rapprochement manuel | `/api` | `supplierInvoiceManualMatchingRoutes` | oui | oui | 2 | oui | planned | declare | audit |
| Fournisseurs | Import factures patch | `/api` | `supplierInvoiceImportPatchRoutes` | oui | oui | 2 | oui | planned | declare | audit |
| Fournisseurs | Mappings CRUD | `/api` | `supplierArticleMappingsCrudRoutes` | oui | oui | 2 | oui | planned | declare | audit |
| Fournisseurs | Mappings | `/api` | `supplierArticleMappingsRoutes` | oui | oui | 1 | selon role | planned | declare | audit |
| Fournisseurs | Factures | `/api` | `supplierInvoicesRoutes` | oui | oui | 2 | oui | planned | declare | audit |
| Achats | Achats | `/api` | `routes/purchases.js` | oui | oui | 2 | oui | `prepare_purchase` | contrat declare | registry |
| Ventes | Unite vente | `/api` | `saleUnitNormalizerRoutes` | oui | oui | 1 | non | planned | declare | audit |
| Ventes | Validation BL forcee | `/api` | `deliveryNoteValidationForcedRoutes` | oui | oui | 3 | oui renforcee | planned | non executable | audit |
| Ventes | BL negoce editable | `/api` | `deliveryNotesNegoceEditableRoutes` | oui | oui | 2 | oui | planned | declare | audit |
| Ventes | BL editable | `/api` | `deliveryNotesEditableRoutes` | oui | oui | 2 | oui | planned | declare | audit |
| Negoce | Correctifs | `/api` | `negoceFixesRoutes` | oui | oui | 2 | oui | planned | declare | audit |
| Communications | BL communications | `/api` | `deliveryNoteCommunicationsRoutes` | oui | oui | 2 | oui | `preview_delivery_note_email` | a completer | audit |
| Ventes | BL | `/api` | `deliveryNotesRoutes` | oui | oui | 2 | oui | `validate_delivery_note` | contrat declare | registry |
| Ventes | Commandes | `/api/sales` | `salesRoutes` | oui | oui | 2 | oui | `search_sales`, `prepare_customer_order` | lecture raccordee | registry |
| Dashboard | Tableau de bord | `/api` | `dashboardRoutes` | oui | non | 0 | non | `analyze_business_performance` | contrat declare | registry |
| Royale Maree | Reglement | `/api` | `royaleMareeSettlementRoutes` | oui | oui | 2 | oui | planned | declare | audit |
| Statistiques | Statistiques | `/api` | `statisticsRoutes` | oui | non | 0 | non | `analyze_business_performance` | contrat declare | registry |
| Stock | Regularisation | `/api/stock` | `stockRegularizationRoutes` | oui | oui | 2 | oui | `prepare_stock_regularization` | contrat declare | registry |
| Stock | Stock | `/api/stock` | `stockRoutes` | oui | oui | 2 | oui | `search_stock` | lecture raccordee | registry |
| Tracabilite | Tracabilite | `/api/traceability` | `traceabilityRoutes` | oui | non | 0 | non | planned | declare | audit |
| Qualite | QMS | `/api/quality` | `qualityRoutes` | oui | oui | 2 | oui | `list_quality_zones`, `record_temperature_reading` | contrat declare | registry |
| Transformations | Creation | `/api/transformations` | `transformationCreationRoutes` | oui | oui | 2 | oui | `prepare_transformation` | contrat declare | registry |
| Transformations | Liste | `/api/transformations` | `transformationListRoutes` | oui | non | 0 | non | `get_transformations` | contrat declare | registry |
| Transformations | Details | `/api/transformations` | `transformationDetailsRoutes` | oui | non | 0 | non | `get_transformations` | contrat declare | registry |
| Transformations | Update | `/api/transformations` | `transformationUpdateRoutes` | oui | oui | 2 | oui | `prepare_transformation` | contrat declare | registry |
| Transformations | Validation | `/api/transformations` | `transformationValidationRoutes` | oui | oui | 2 | oui | `prepare_transformation` | contrat declare | registry |
| Transformations | General | `/api/transformations` | `transformationsRoutes` | oui | oui | 2 | oui | `get_transformations` | contrat declare | registry |
| Agent | Assistant interne | `/api` | `aiAgentRoutes` | oui | oui | 2 | oui | registre central | boucle/prompt maj | node check |
| Planning | Salaries | `/api/employee-planning` | `employeePlanningRoutes` | oui | oui | 2 | oui | `get_employee_planning` | contrat declare | registry |
| Agent | REST agent | `/api/agent` | `agentActionsRouter` | oui | oui | 2 | oui | `/api/agent/tools` | raccorde | registry |
| Intelligence | Centre surveillance | `/api` | `intelligenceCenterRoutes` | oui | non | 0 | non | planned | declare | audit |
| Pennylane | Integration | `/api` | `pennylaneIntegrationRoutes` | oui | oui | 2 | oui | `get_pennylane_sync_status` | contrat declare | registry |
| Pennylane | Factures fournisseurs | `/api` | `pennylaneSupplierInvoicesRoutes` | oui | oui | 2 | oui | planned | declare | audit |
| Finance | Reporting | `/api` | `financialReportsRoutes` | oui | non | 0 | non | `analyze_business_performance` | contrat declare | registry |
| Tresorerie | Cashflow | `/api` | `cashflowRoutes` | oui | oui | 2 | oui | `get_cashflow_forecast`, `prepare_cashflow_plan` | lecture raccordee | registry |
| MCP | Serveur MCP | `/mcp` | `mcpServerRoutes` | oui | oui | 2 | oui | registre central MCP | raccorde | node check |

## Suites identifiees

- Raccorder progressivement les handlers `planned` aux services metier existants.
- Unifier `ai_pending_actions` et `agent_pending_actions` ou documenter clairement leurs usages separes.
- Ajouter des tests DB d isolation magasin avec fixtures.
