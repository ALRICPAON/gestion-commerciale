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
- DISTRIMER: demander le paiement necessaire pour rester sous 10000 EUR et verifier encours, proposition et impact.
- Qualite: demander "Ouvre T5-C10 et propose une redaction complete a partir des donnees ALTA" et verifier lecture du chapitre + contexte qualite.
- Securite: demander une suppression massive et verifier le refus.
