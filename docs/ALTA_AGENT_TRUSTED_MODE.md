# ALTA Agent Trusted Owner Mode

`ALTA_AGENT_TRUSTED_MODE=true` active le mode proprietaire de confiance pour l agent MCP ALTA.

Dans ce mode, l agent agit pour le proprietaire ALTA MAREE: il peut lire et executer les actions metier exposees par le serveur MCP sans etre bloque par `ALTA_AGENT_PERMISSIONS`, `agent.use`, `mcp.execute`, les permissions metier, les pending actions ou `confirmation=human_confirmed`.

Le mode securise reste disponible avec:

```bash
ALTA_AGENT_TRUSTED_MODE=false
```

ou si la variable est absente.

## Activation VPS

Dans `backend/.env`:

```bash
ALTA_AGENT_TRUSTED_MODE=true
ALTA_AGENT_USER_ID=<uuid-utilisateur-technique-pour-audit>
```

Redemarrer l API:

```bash
pm2 restart gestion-commerciale
```

Au demarrage, les logs doivent afficher:

```text
ALTA MCP trusted owner mode enabled
```

En mode securise:

```text
ALTA MCP secure permission mode enabled
```

Apres changement du catalogue MCP, reconnecter le client MCP pour forcer `initialize` et `tools/list`.

## Ce que le mode trusted simplifie

- pas de blocage par `ALTA_AGENT_PERMISSIONS`;
- pas de controle du role utilisateur;
- pas de controle `agent.use` ou `mcp.execute`;
- pas de controle des permissions metier;
- pas d obligation de pending action avant execution;
- pas d obligation `confirmation=human_confirmed`;
- les pending actions historiques avec empreinte invalide peuvent etre executees une seule fois.

## Protections conservees

- isolation stricte par `store_id`;
- validation des payloads;
- execution uniquement des actions du registre metier allowliste;
- aucune execution SQL libre;
- aucune commande shell;
- aucune lecture de secrets ou de `.env`;
- transactions pour les actions sensibles;
- protection anti double execution des pending actions;
- ecritures via les services metier existants;
- audit non bloquant de chaque appel outil agent.

## Action qualite directe

Outil MCP:

```text
quality.documentation.apply_section_updates
```

Payload minimal:

```json
{
  "updates": [
    {
      "section_id": "uuid-section",
      "content_html": "<p>Test orchestrateur MCP trusted mode</p>",
      "change_summary": "Test trusted mode"
    }
  ]
}
```

L outil appelle `qualityDocumentationService.updateSection`, cree une version et conserve l historique.

## Tests

```bash
node backend/scripts/test-agent-action-orchestrator.js
node backend/scripts/test-agent-tool-registry.js
node backend/scripts/test-agent-pending-actions.js
node backend/scripts/test-agent-permissions-context.js
node backend/scripts/audit-agent-mcp-tools.js
```

## Scenario manuel

1. Activer `ALTA_AGENT_TRUSTED_MODE=true`.
2. Redemarrer l API.
3. Reconnecter le client MCP.
4. Demander a l agent de lire `T1-C01`.
5. Lui demander d ajouter: `Test orchestrateur MCP trusted mode`.
6. Relire `T1-C01`.
7. Verifier:
   - phrase presente;
   - nouvelle version creee;
   - audit cree;
   - aucun pending action obligatoire;
   - aucune erreur de permission;
   - aucune erreur d empreinte;
   - aucune confirmation supplementaire.

## Rollback

Revenir au mode securise:

```bash
ALTA_AGENT_TRUSTED_MODE=false
pm2 restart gestion-commerciale
```

Rollback code si necessaire:

```bash
git revert <commit-trusted-mode>
pm2 restart gestion-commerciale
```
