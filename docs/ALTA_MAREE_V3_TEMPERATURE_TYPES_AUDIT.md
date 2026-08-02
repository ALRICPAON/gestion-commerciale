# Audit MCP - Referentiel types temperature

## Diagnostic

Le front ALTA permet de creer et modifier des parametres temperature, mais il charge d'abord le referentiel natif des types:

| Capacite front | Route backend | Service metier | Table | Outil MCP | Statut |
|---|---|---|---|---|---|
| Lister les types temperature actifs | `GET /api/quality/temperatures/types` | `quality/temperatures.listTemperatureTypes` | `quality_temperature_types` | `list_quality_temperature_types` | couvert |
| Creer un parametre temperature | `POST /api/quality/temperatures/limits` | `quality/temperatures.saveTemperatureLimit` | `quality_temperature_limits` | `create_quality_temperature_parameter` | couvert |
| Modifier un parametre temperature | `PUT /api/quality/temperatures/limits/:id` | `quality/temperatures.saveTemperatureLimit` | `quality_temperature_limits` | `update_quality_temperature_parameter` | couvert |

La contrainte PostgreSQL `quality_temperature_limits.type_code -> quality_temperature_types(code)` impose un code de type existant. Avant ce correctif, le MCP exposait les outils d'ecriture, mais pas le referentiel permettant de choisir un `type_code` valide.

## Referentiel natif

La migration `backend/db/gestion-commerciale/20260705_quality_temperatures.sql` cree `quality_temperature_types` et seed les codes:

- `COLD_ROOM`
- `WORKSHOP`
- `RECEPTION_PRODUCTS`
- `SHIPPING`
- `VEHICLE`
- `LIVE_TANK`
- `FREEZER`
- `PRODUCT_TEMPERATURE`

## Correctif MCP

- `list_quality_temperature_types` expose la meme source que le front.
- `create_quality_temperature_parameter` et `update_quality_temperature_parameter` documentent que `type_code` doit venir de `list_quality_temperature_types`.
- `quality/temperatures.saveTemperatureLimit` valide le code actif avant `INSERT` ou `UPDATE`.
- Un code inconnu ou inactif retourne une erreur metier 400 listant les codes actifs autorises.
- La matrice front/backend rend obligatoire la couverture de `GET /api/quality/temperatures/types`; `coverage_complete` ne peut plus rester `true` si cet outil manque.

## Tests

Le script `backend/scripts/test-quality-temperature-type-mcp-tools.js` verifie:

- listing MCP des types actifs;
- refus sans `quality.configuration.write` pour les ecritures;
- creation avec `type_code` valide;
- modification avec `type_code` valide;
- refus clair d'un `type_code` inconnu ou inactif avant requete `INSERT` ou `UPDATE`.
