# Orchestrateur actions MCP ALTA

L agent MCP ne doit executer une ecriture que via une action metier allowlistee.

Flux standard:

1. lire les donnees necessaires;
2. produire un apercu ou un payload prepare;
3. creer une pending action avec `create_pending_action`;
4. attendre une confirmation explicite utilisateur;
5. executer `execute_pending_action` avec `confirmation=human_confirmed`;
6. retourner le resultat metier reel.

Permissions requises:

- `mcp.execute`;
- la permission metier de l action, par exemple `quality.documentation.edit`;
- les memes droits doivent etre presents cote utilisateur et cote agent configure.
- un `user_id` doit etre present dans le contexte MCP, par exemple via l utilisateur connecte ou `ALTA_AGENT_USER_ID` pour un connecteur serveur.

Statuts `agent_pending_actions`:

- `prepared`;
- `awaiting_confirmation`;
- `executing`;
- `executed`;
- `failed`;
- `cancelled`.

La migration a appliquer est:

```bash
backend/db/gestion-commerciale/062_agent_pending_actions_orchestrator.sql
```

## Documentation qualite

Action:

```text
quality.documentation.apply_section_updates
```

Payload:

```json
{
  "collection_id": "uuid-optionnel",
  "mode": "all_or_nothing",
  "updates": [
    {
      "section_id": "uuid-section",
      "content_html": "<p>Contenu valide</p>",
      "status": "ready_for_review",
      "change_summary": "Application du paquet Tome 1"
    }
  ]
}
```

Le mode `all_or_nothing` utilise une transaction: si un chapitre echoue, aucun chapitre du lot n est conserve. Le service appele pour chaque chapitre est `qualityDocumentationService.updateSection`, ce qui conserve les versions et historiques existants.

## Audit

Generer la matrice courante:

```bash
node backend/scripts/audit-agent-mcp-tools.js
```

Colonnes produites:

| Outil MCP | Module | Lecture / Preparation / Execution | Permission | Service metier appele | Fonctionnel actuellement | Ecart |
|---|---|---|---|---|---|---|

Les lignes `Execution directe a auditer progressivement` doivent etre traitees module par module en ajoutant une entree au registre central, avec validation stricte du payload et test d execution.
