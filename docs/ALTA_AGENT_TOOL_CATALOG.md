# Catalogue outils Agent ALTA

Le catalogue executable est fourni par:

```bash
node backend/scripts/test-agent-tool-registry.js
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
- actions differees: `create_pending_action`, `execute_pending_action`;
- tresorerie: `get_cashflow_dashboard`, `get_cashflow_forecast`, `get_customer_receivables`, `get_supplier_payables`, `get_bank_accounts_summary`, `get_bank_transactions`, `get_recurring_charges`, `get_cashflow_settings`, `simulate_distrimer_payment`, `prepare_cashflow_plan`;
- dossier qualite: `list_quality_documentation`, `get_quality_documentation_outline`, `get_quality_section`, `search_quality_sections`, `list_quality_missing_items`, `get_quality_section_versions`, `draft_quality_section_content`, `preview_quality_section_update`, `update_quality_section`, `create_quality_section`, `restore_quality_section_version`, `list_quality_section_tables`, `list_quality_section_diagrams`, `export_quality_documentation_preview`;
- audit admin: `list_agent_audit_logs`, `get_agent_audit_log`.

Les autres capacites demandees sont declarees comme contrats non executables directement tant que le service metier explicite n est pas raccorde.
