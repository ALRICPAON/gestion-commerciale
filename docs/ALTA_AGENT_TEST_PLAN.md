# Plan de test Agent ALTA

Tests automatises ajoutes:

```bash
node backend/scripts/test-agent-tool-registry.js
node --check backend/services/agent/agentToolRegistry.js
node --check backend/services/agent/agentToolExecutor.js
node --check backend/routes/mcpServer.js
node --check backend/routes/agentActions.js
node --check backend/services/cashflow/service.js
node --check backend/services/quality/agentQualityContextService.js
node backend/scripts/test-agent-pending-actions.js
node backend/scripts/test-agent-action-orchestrator.js
node backend/scripts/test-agent-permissions-context.js
node backend/scripts/audit-agent-mcp-tools.js
node backend/scripts/test-agent-cashflow-live.js --store-id=<STORE_UUID>
```

Tests requis avec base de donnees:

- isolation magasin A/B sur chaque handler raccorde;
- audit succes, erreur et confirmation;
- dossier qualite: lecture, recherche, brouillon, apercu, mise a jour versionnee, restauration;
- tresorerie: dashboard, forecast, separation hypotheses/donnees reelles, simulation DISTRIMER;
- MCP: `initialize`, `tools/list`, `tools/call`, Streamable HTTP et SSE legacy;
- UI: confirmation, annulation, sources, avertissements, reprise conversation.

Scenarios manuels ajoutes:

- Capacites: demander "Fais un etat complet de tes capacites ALTA" et verifier operational/partial/planned.
- Tresorerie: demander "Fais-moi une prevision de tresorerie a 30 jours basee sur les donnees ALTA" et verifier sources, flux, point bas et avertissements.
- Routage tresorerie: les demandes explicites prevision/plan/projection tresorerie ou cashflow avec horizon doivent appeler `prepare_cashflow_plan` avant tout outil generique.
- MCP: apres changement de catalogue, reconnecter le client MCP si le client ne consomme pas `tools.listChanged`.
- DISTRIMER: demander le paiement necessaire pour rester sous 10000 EUR et verifier encours, proposition et impact.
- Qualite: demander "Ouvre T5-C10 et propose une redaction complete a partir des donnees ALTA" et verifier lecture du chapitre + contexte qualite.
- Execution qualite: preparer une pending action `quality.documentation.apply_section_updates` avec plusieurs chapitres du Tome 1, confirmer avec `execute_pending_action` + `confirmation=human_confirmed`, puis verifier que chaque chapitre a une version et que la pending action est `executed`.
- Permissions execution: verifier qu'une execution sans `mcp.execute` ou sans `quality.documentation.edit` retourne `Permission requise` et ne modifie aucun chapitre.
- Double execution: relancer `execute_pending_action` sur la meme action et verifier un refus 409.
- Securite: demander une suppression massive et verifier le refus.
