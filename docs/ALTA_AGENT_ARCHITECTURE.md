# Architecture Agent ALTA

Le socle agent est centralise dans `backend/services/agent`.

- `agentToolRegistry.js`: catalogue unique des outils, domaines, schemas, permissions, risques et handlers.
- `agentToolExecutor.js`: execution commune avec contexte authentifie, limitation de taille, permission, confirmation et audit.
- `agentAuthorizationService.js`: controle permissions et roles.
- `agentAuditService.js`: masquage des donnees sensibles et journal `agent_tool_audit_logs`.
- `agentModuleCatalog.js`: catalogue maintenu des modules et chemins UI.
- `agentToolSchemas.js`: schemas et niveaux de risque partages.

Le MCP consomme ce registre pour `tools/list` et `tools/call`, puis ajoute dans `backend/routes/mcpServer.js` les wrappers publics necessaires au connecteur ChatGPT quand un nom interne canonique contient des points. Les routes REST agent exposent aussi `/api/agent/tools` et `/api/agent/tools/:name/call`.

Le modele ne recoit pas d outil SQL libre, shell, secret, route generique ou suppression generique.
