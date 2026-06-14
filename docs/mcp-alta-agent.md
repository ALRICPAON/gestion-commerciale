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
