# Plan de test Agent ALTA

Tests automatises ajoutes:

```bash
node backend/scripts/test-agent-tool-registry.js
node --check backend/services/agent/agentToolRegistry.js
node --check backend/services/agent/agentToolExecutor.js
node --check backend/routes/mcpServer.js
node --check backend/routes/agentActions.js
```

Tests requis avec base de donnees:

- isolation magasin A/B sur chaque handler raccorde;
- audit succes, erreur et confirmation;
- dossier qualite: lecture, recherche, brouillon, apercu, mise a jour versionnee, restauration;
- tresorerie: dashboard, forecast, separation hypotheses/donnees reelles, simulation DISTRIMER;
- MCP: `initialize`, `tools/list`, `tools/call`, Streamable HTTP et SSE legacy;
- UI: confirmation, annulation, sources, avertissements, reprise conversation.
