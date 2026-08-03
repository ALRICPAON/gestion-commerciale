# Audit poste de travail qualite operationnel

## Synthese

La PR introduit un poste central `Qualite du jour` et une vue lecture seule `Controle DDPP`.

Le principe retenu est de conserver les objets de configuration comme sources metier:

- les parametres temperature configurent les seuils, jours et horaires;
- les plans de nettoyage configurent les operations PMS;
- `quality_tasks` reste la definition de travail a executer;
- `quality_task_occurrences` represente chaque echeance reelle;
- les preuves restent dans les enregistrements metier (`quality_temperature_records`, `quality_cleaning_records`);
- les non-conformites et actions correctives sont rattachees aux enregistrements, taches, occurrences, zones et equipements.

Aucune logique parallele n'est creee: les executions appellent les services existants de temperatures, nettoyage et taches.

## Audit initial

| Domaine | Existant reutilise | Manque constate | Correction |
| --- | --- | --- | --- |
| Dashboard qualite | `frontend/quality/pages/dashboard.html` | Parcours disperse entre taches, temperatures et nettoyage | Ajout des entrees principales `Qualite du jour` et `Controle DDPP` |
| Taches du jour/retard/a venir | `quality_tasks`, `taskScheduler`, `listQualityTasks` | Pas d'occurrence stable par creneau | Nouvelle table additive `quality_task_occurrences` |
| Temperatures | `quality_temperature_limits`, `quality_temperature_records`, `saveTemperatureRecord` | Execution depuis un poste central sans lien occurrence | Ajout liens `quality_task_id`, `occurrence_id`, `method_used` |
| Nettoyages | `quality_cleaning_plans`, `quality_cleaning_records`, `createCleaningRecord` | Execution centrale et snapshot de preuve incomplets | Ajout champs execution, preuves et `execution_snapshot` |
| Non-conformites | Permissions prevues `quality.nc.manage` | Pas de table operationnelle standardisee dans ce flux | Ajout `quality_non_conformities` |
| Actions correctives | Permission prevue `quality.action.manage` | Pas de table operationnelle standardisee dans ce flux | Ajout `quality_corrective_actions` |
| MCP | Registre V3 et couverture front/backend | Outils operationnels absents | 9 outils publics ajoutes |

## Architecture

`backend/services/quality/operations.js` orchestre uniquement le poste operationnel:

- lecture `listQualityTodayWork`;
- lecture `getDdppDashboard`;
- execution temperature via `saveTemperatureRecord`;
- execution nettoyage via `createCleaningRecord`;
- execution tache manuelle via `updateQualityTaskStatus`;
- declaration et cloture des non-conformites;
- creation d'actions correctives.

Les taches `SYSTEM` verrouillees ne peuvent pas etre terminees directement. Elles doivent passer par leur formulaire metier, ce qui cree d'abord l'enregistrement temperature ou nettoyage puis historise la tache.

## Migration

Migration additive et idempotente:

`backend/db/gestion-commerciale/068_quality_operational_workstation.sql`

Elle cree:

- `quality_task_occurrences`;
- `quality_non_conformities`;
- `quality_corrective_actions`;

Elle ajoute sans backfill destructif:

- `quality_temperature_records.temperature_limit_id`;
- `quality_temperature_records.quality_task_id`;
- `quality_temperature_records.occurrence_id`;
- `quality_temperature_records.method_used`;
- `quality_cleaning_records.occurrence_id`;
- `quality_cleaning_records.visual_check_status`;
- `quality_cleaning_records.anomaly_comment`;
- `quality_cleaning_records.corrective_action`;
- `quality_cleaning_records.evidence_photo_id`;
- `quality_cleaning_records.evidence_document_id`;
- `quality_cleaning_records.execution_snapshot`.

## Routes

Nouveau namespace:

- `GET /api/quality/operations/today`;
- `GET /api/quality/operations/overdue`;
- `GET /api/quality/operations/ddpp`;
- `GET /api/quality/operations/non-conformities`;
- `POST /api/quality/operations/temperature-occurrences/execute`;
- `POST /api/quality/operations/cleaning-occurrences/execute`;
- `POST /api/quality/operations/manual-occurrences/execute`;
- `POST /api/quality/operations/non-conformities`;
- `POST /api/quality/operations/corrective-actions`;
- `POST /api/quality/operations/non-conformities/:id/close`.

## Frontend

Nouveaux ecrans:

- `frontend/quality/pages/quality-today.html`;
- `frontend/quality/pages/quality-ddpp.html`.

Nouveaux scripts:

- `frontend/quality/js/operations-api.js`;
- `frontend/quality/js/quality-today.js`;
- `frontend/quality/js/quality-ddpp.js`.

Le dashboard qualite pointe vers ces vues sans supprimer les ecrans de configuration existants.

## MCP

Nouveaux outils publics:

- `get_quality_today_work`;
- `get_quality_overdue_work`;
- `get_quality_ddpp_dashboard`;
- `execute_quality_temperature_occurrence`;
- `execute_quality_cleaning_occurrence`;
- `execute_quality_manual_occurrence`;
- `create_quality_non_conformity`;
- `create_quality_corrective_action`;
- `close_quality_non_conformity`.

Permissions ajoutees a la couverture finale:

- `quality.record.create`;
- `quality.nc.manage`;
- `quality.action.manage`.

`close_quality_non_conformity` reste une action engageante avec confirmation humaine.

## Verification

Commandes PC:

```powershell
node --check backend/services/quality/operations.js
node --check backend/routes/quality/operations.js
node --check backend/services/agent/agentToolRegistry.js
node --check backend/services/quality/temperatures.js
node --check backend/services/quality/cleaning.js
node --check backend/services/quality/tasks.js
node --check frontend/quality/js/operations-api.js
node --check frontend/quality/js/quality-today.js
node --check frontend/quality/js/quality-ddpp.js
node backend/scripts/test-quality-operational-workstation.js
node backend/scripts/test-agent-mcp-coverage-matrix.js
node backend/scripts/test-mcp-public-tools-list.js
node backend/scripts/test-agent-tool-registry.js
node backend/scripts/test-agent-permissions-context.js
node backend/scripts/test-quality-agent-configuration-tools.js
node backend/scripts/test-quality-router-startup.js
```

Commandes VPS apres merge:

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
psql "$DATABASE_URL" -f backend/db/gestion-commerciale/068_quality_operational_workstation.sql
pm2 restart gestion-commerciale
```

Commande de verification schema:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_name IN ('quality_task_occurrences','quality_non_conformities','quality_corrective_actions')
ORDER BY table_name;
```
