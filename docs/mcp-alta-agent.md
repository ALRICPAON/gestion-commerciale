# Serveur MCP ALTA MAREE

URL à déclarer dans ChatGPT Business Apps :

```text
https://api.altamaree.fr/mcp
```

## Authentification

Le serveur MCP réutilise la même clé que l'API Agent REST :

```http
Authorization: Bearer <ALTA_AGENT_API_KEY>
```

Aucun secret ne doit être stocké dans le dépôt. La variable `ALTA_AGENT_API_KEY` reste côté VPS.

## Compatibilité OpenAI Apps SDK

Le serveur expose les éléments attendus par ChatGPT Apps en plus du transport MCP :

- descripteurs de tools avec `securitySchemes` et miroir `_meta.securitySchemes` ;
- statuts `_meta["openai/toolInvocation/invoking"]` et `_meta["openai/toolInvocation/invoked"]` ;
- template `_meta["openai/outputTemplate"]` pointant vers `ui://widget/alta-maree-connected.html` ;
- ressource HTML `text/html;profile=mcp-app` lisible via `resources/read` ;
- CSP widget minimal sans exposition de secret.

La ressource Apps SDK affiche simplement `ALTA MAREE connecté`. Elle sert de template d'attachement pour ChatGPT Business Apps et ne remplace pas le frontend ALTA.

## Transports MCP supportés

Le serveur supporte les deux modes utiles pour ChatGPT Business Apps et les outils de diagnostic :

- Streamable HTTP : POST JSON-RPC direct sur `/mcp`, réponse JSON directe.
- HTTP+SSE legacy : GET `/mcp` ouvre un flux SSE, envoie un événement `endpoint` avec un `sessionId`, puis les POST vers cet endpoint renvoient leurs réponses dans le flux SSE via des événements `message`.

## Outils exposés

- `search_clients`
- `search_articles`
- `search_stock`
- `search_suppliers`
- `search_sales`
- `create_pending_action`
- `get_pending_action`
- `execute_pending_action`

Etat attendu du catalogue public complet ALTA MAREE V3 apres cette evolution:

- version `1.8.4`;
- `tool_count: 180`;
- `coverage_complete: true`;
- `missing_tools: []`;
- `frontend_backend_coverage_complete: true`;
- `missing_frontend_backend_capabilities: []`.

Outils qualite operationnels ajoutes:

- `get_quality_today_work`
- `get_quality_overdue_work`
- `get_quality_ddpp_dashboard`
- `execute_quality_temperature_occurrence`
- `execute_quality_cleaning_occurrence`
- `execute_quality_manual_occurrence`
- `create_quality_non_conformity`
- `create_quality_corrective_action`
- `close_quality_non_conformity`

Les outils de recherche sont limités à 25 résultats maximum et utilisent les mêmes règles que `/api/agent/*`.

## Règles de sécurité

- Pas de SQL libre.
- Pas de suppression.
- Pas d'écriture métier directe.
- Les actions sensibles passent par `agent_pending_actions`.
- `execute_pending_action` exige `confirmation: "human_confirmed"`.
- L'exécution MCP conserve le comportement du socle agent : elle marque l'action comme exécutée mais ne crée pas encore de vente, BL, facture, achat ou email métier.

## Vérification Streamable HTTP

Initialisation MCP :

```bash
curl -X POST https://api.altamaree.fr/mcp \
  -H 'Authorization: Bearer <ALTA_AGENT_API_KEY>' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'
```

Liste des outils :

```bash
curl -X POST https://api.altamaree.fr/mcp \
  -H 'Authorization: Bearer <ALTA_AGENT_API_KEY>' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

La réponse doit contenir les outils métier et leurs métadonnées Apps SDK, dont `_meta.openai/outputTemplate` et `_meta.openai/toolInvocation/*`.

Appel outil :

```bash
curl -X POST https://api.altamaree.fr/mcp \
  -H 'Authorization: Bearer <ALTA_AGENT_API_KEY>' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_clients","arguments":{"query":"royale","limit":5}}}'
```

La réponse doit retourner ROYALE MAREE si la donnée est présente dans la base cible.

Liste des ressources Apps SDK :

```bash
curl -X POST https://api.altamaree.fr/mcp \
  -H 'Authorization: Bearer <ALTA_AGENT_API_KEY>' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":4,"method":"resources/list","params":{}}'
```

Lecture du template HTML Apps SDK :

```bash
curl -X POST https://api.altamaree.fr/mcp \
  -H 'Authorization: Bearer <ALTA_AGENT_API_KEY>' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":5,"method":"resources/read","params":{"uri":"ui://widget/alta-maree-connected.html"}}'
```

La réponse doit contenir un contenu `text/html;profile=mcp-app` avec le texte `ALTA MAREE connecté`.

## Vérification HTTP+SSE legacy

Ouvrir le flux SSE :

```bash
curl -N https://api.altamaree.fr/mcp \
  -H 'Authorization: Bearer <ALTA_AGENT_API_KEY>' \
  -H 'Accept: text/event-stream'
```

La première réponse doit contenir un événement de ce type :

```text
event: endpoint
data: https://api.altamaree.fr/mcp?sessionId=<SESSION_ID>
```

Dans un second terminal, envoyer un POST JSON-RPC vers l'endpoint reçu :

```bash
curl -X POST 'https://api.altamaree.fr/mcp?sessionId=<SESSION_ID>' \
  -H 'Authorization: Bearer <ALTA_AGENT_API_KEY>' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":6,"method":"tools/list","params":{}}'
```

Le POST doit répondre `202 Accepted`, et le premier terminal doit recevoir un événement `message` contenant la réponse JSON-RPC.
# Evolution registre central

Le serveur MCP ALTA consomme maintenant le registre central `backend/services/agent/agentToolRegistry.js`.

Les nouveaux outils exposes par MCP respectent:

- schema d entree et sortie declare;
- domaine et niveau de risque;
- permission requise;
- confirmation humaine pour risque 2 et 3;
- audit dans `agent_tool_audit_logs` lorsque la table est disponible.

Configurer les permissions de l identite technique avec `ALTA_AGENT_PERMISSIONS`.

## Configuration Qualite par ALTA_MAREE_V3

La configuration des taches qualite et plans de nettoyage passe par la permission dediee `quality.configuration.write`, en plus de `quality.read`. Ne pas utiliser `quality.admin` pour ce perimetre.

Outils MCP d'ecriture controles:

- `quality_create_task`;
- `quality_update_task`;
- `quality_create_cleaning_plan`;
- `quality_update_cleaning_plan`;
- `quality_assign_task_to_zone`;
- `quality_assign_task_to_equipment`;
- `quality_activate_configuration`;
- `quality_deactivate_configuration`.

Garanties:

- authentification MCP et `store_id` requis;
- permission utilisateur et permission agent verifiees;
- zones/equipements verifies dans le meme magasin;
- creations agent en `pending_review` et inactives par defaut;
- refus de modification d'une tache deja executee;
- refus d'activation d'un plan incomplet;
- aucune suppression physique exposee;
- audit via `agent_tool_audit_logs`.

## Couverture ALTA_MAREE_V3

Depuis la version MCP `1.8.4`, `tools/list` expose le catalogue ALTA_MAREE_V3 complet et les metadonnees de verification:

- `coverage_complete`;
- `missing_tools`;
- `frontend_backend_coverage_complete`;
- `missing_frontend_backend_capabilities`;
- `final_permissions`;
- `coverage_matrix`;
- `frontend_backend_capabilities`.

Les capacites front confirmees exposees dans ce correctif incluent:

- `list_quality_temperature_types`;
- `list_quality_temperature_parameters`;
- `get_quality_temperature_parameter`;
- `create_quality_temperature_parameter`;
- `update_quality_temperature_parameter`;
- `archive_or_disable_quality_temperature_parameter`;
- `list_quality_cleaning_plans`;
- `get_quality_cleaning_plan`;
- `create_quality_cleaning_plan`;
- `update_quality_cleaning_plan`;
- `archive_or_disable_quality_cleaning_plan`.

Pour les parametres temperature, `list_quality_temperature_types` expose le referentiel actif utilise par le front (`GET /api/quality/temperatures/types`) et par le service `quality/temperatures.listTemperatureTypes`. Il doit etre appele avant `create_quality_temperature_parameter` ou `update_quality_temperature_parameter`; les codes seedes sont `COLD_ROOM`, `WORKSHOP`, `RECEPTION_PRODUCTS`, `SHIPPING`, `VEHICLE`, `LIVE_TANK`, `FREEZER` et `PRODUCT_TEMPERATURE`.

Les plans de nettoyage acceptent maintenant plusieurs zones et plusieurs equipements via `zone_ids` et `equipment_ids`. Les anciens champs `zone_id` et `equipment_id` restent acceptes et restent retournes pour compatibilite; les lectures `list_quality_cleaning_plans` et `get_quality_cleaning_plan` retournent aussi `zones: []` et `equipments: []`.

Pour le nettoyage, le plan PMS est la source de verite. Les champs `responsible_user_id`, `frequency_value`, `frequency_unit`, `target_time`, `scheduled_days`, `expected_duration_minutes`, `method`, `expected_proof` et `corrective_action` appartiennent au plan. ALTA cree ou met a jour automatiquement la `quality_task` liee; ne pas creer une tache nettoyage separee pour un plan.

Les champs de planification exposes pour les parametres temperature et plans nettoyage sont `planning_mode`, `quality_task_id`, `task_title`, `responsible_user_id`, `frequency_value`, `frequency_unit` et `target_time`.
Pour les parametres temperature natifs, le planning supporte aussi `scheduled_days` et `target_times`. ALTA MARÉE ouvre lundi a vendredi de 04:00 a 12:00, samedi de 04:00 a 10:00, et reste ferme dimanche; les jours actifs MCP acceptes sont donc `monday`, `tuesday`, `wednesday`, `thursday`, `friday` et `saturday`. Le champ legacy `target_time` reste compatible et correspond au premier horaire cible lorsque `target_times` est fourni.

### Architecture Qualite SYSTEM / MANUAL

Les taches qualite exposent maintenant une origine metier explicite:

- `task_origin=SYSTEM`: tache generee et synchronisee par une source ALTA native (`cleaning_plan`, `temperature_parameter`, future maintenance/calibration/nuisibles/audit). Elle porte `source_entity_type`, `source_entity_id` et `source_locked=true`.
- `task_origin=MANUAL`: tache creee directement par un utilisateur ou par l'agent pour un besoin manuel. Elle reste modifiable selon les permissions et l'absence d'historique.

Les outils MCP `quality_update_task` et les routes front refusent la modification directe d'une tache `SYSTEM` verrouillee. Il faut modifier la source native:

- plan de nettoyage via `update_quality_cleaning_plan` ou `archive_or_disable_quality_cleaning_plan`;
- parametre temperature via `update_quality_temperature_parameter` ou `archive_or_disable_quality_temperature_parameter`.

Les parametres temperature sont aussi sources de verite: `create_quality_temperature_parameter` cree ou synchronise automatiquement les taches systeme liees, `update_quality_temperature_parameter` les met a jour, et `archive_or_disable_quality_temperature_parameter` archive logiquement les taches liees. Lorsque plusieurs jours et horaires sont fournis, une tache `SYSTEM` verrouillee est maintenue par creneau via `quality_temperature_limit_tasks`, tandis que `quality_task_id` reste le lien primaire legacy. Les anciens champs `quality_task_id`, `zone_id`, `equipment_id` et `target_time` restent compatibles.

Le diagnostic des anciennes taches QF-01..QF-13 reste lecture seule:

```bash
node backend/scripts/diagnose-quality-legacy-qf-tasks.js <STORE_ID>
```

Il retourne pour chaque tache l'historique, les correspondances possibles avec un parametre temperature ou un plan de nettoyage, et une recommandation. Aucun archivage automatique n'est effectue.

La configuration recommandee de l'identite technique est:

```text
ALTA_AGENT_PERMISSIONS=mcp.execute,agent.use,clients.read,clients.write,suppliers.read,suppliers.write,articles.read,articles.write,stock.read,stock.write,purchases.read,purchases.write,sales.read,sales.write,communications.read,communications.send,statistics.read,cashflow.read,cashflow.write,pennylane.read,pennylane.sync,employee_planning.read,employee_planning.write,transformations.read,transformations.write,quality.read,quality.configuration.write,quality.documentation.read,quality.documentation.edit
```

La matrice complete est documentee dans `docs/ALTA_MAREE_V3_MCP_FULL_COVERAGE.md`.

Exemple:

```bash
curl -X POST https://api.altamaree.fr/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "x-alta-agent-key: $ALTA_AGENT_KEY" \
  -d '{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"quality_create_cleaning_plan","arguments":{"title":"Materiels contact alimentaire","zone_ids":["<ZONE_ID_1>","<ZONE_ID_2>"],"equipment_ids":["<EQUIPMENT_ID_1>","<EQUIPMENT_ID_2>"],"frequency_value":1,"frequency_unit":"days","target_time":"17:00","method":"A completer"}}}'
```

Test local:

```bash
node backend/scripts/test-quality-agent-configuration-tools.js
node backend/scripts/test-mcp-public-tools-list.js
```
