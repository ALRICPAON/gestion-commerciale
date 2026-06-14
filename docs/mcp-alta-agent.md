# Serveur MCP ALTA MARÉE

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

## Vérification rapide

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

Appel outil :

```bash
curl -X POST https://api.altamaree.fr/mcp \
  -H 'Authorization: Bearer <ALTA_AGENT_API_KEY>' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_clients","arguments":{"query":"royale","limit":5}}}'
```

SSE :

```bash
curl -N https://api.altamaree.fr/mcp \
  -H 'Authorization: Bearer <ALTA_AGENT_API_KEY>' \
  -H 'Accept: text/event-stream'
```
