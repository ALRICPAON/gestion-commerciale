# Flux canoniques d'execution Qualite

## Objectif

Le poste operationnel Qualite, les pages de releves specialisees, les anciennes routes API et les outils MCP utilisent le meme chemin metier:

`parametre/plan/tache -> tache -> occurrence -> execution -> record canonique -> historique -> DDPP`

Cette architecture evite les doubles saisies et les divergences entre `Qualite du jour`, `Releves temperatures`, `Nettoyages` et MCP.

## Services canoniques

- `recordTemperatureControl(db, storeId, userId, payload)`
- `recordCleaningExecution(db, storeId, userId, payload)`

Ces services vivent dans `backend/services/quality/operations.js`.

Ils sont responsables de:

- retrouver ou valider l'occurrence ouverte;
- refuser une occurrence deja completee;
- exiger un motif pour une saisie exceptionnelle sans occurrence;
- creer le record canonique temperature ou nettoyage;
- completer l'occurrence avec `source_record_type` et `source_record_id`;
- conserver une transaction atomique quand le service sous-jacent ouvre une transaction.

Les routes historiques `POST /api/quality/temperatures` et `POST /api/quality/cleaning/records` appellent maintenant ces services. Les routes operationnelles et MCP passent par le meme code.

## Saisie exceptionnelle

Les pages specialisees deviennent des pages d'historique et de saisie exceptionnelle:

- `frontend/quality/pages/temperature-records.html`
- `frontend/quality/pages/cleaning-records.html`

Si une saisie n'est pas rattachee a une occurrence ou une tache planifiee, le motif est obligatoire via `exceptional_reason`.

Le helper commun `frontend/quality/js/quality-execution-forms.js` centralise:

- la deduction `scheduled` / `exceptional`;
- la validation du motif exceptionnel;
- le libelle du formulaire selon le contexte.

## Controles evenementiels

Les taches avec `frequency_unit = 'events'` ne sont jamais classees dans:

- a faire maintenant;
- en retard;
- a venir.

Elles sont exposees dans une section separee:

`Controles a declencher lors d'un evenement`

Le backend renvoie cette section dans `sections.event_controls` et le compteur `summary.event_controls`.

## Migration

`backend/db/gestion-commerciale/070_quality_canonical_execution_sources.sql`

La migration est additive et idempotente:

- `quality_temperature_records.exceptional_reason`;
- `quality_cleaning_records.source`;
- `quality_cleaning_records.exceptional_reason`;
- `quality_cleaning_records.started_at`;
- `quality_cleaning_records.ended_at`;
- index de diagnostic par `store_id`, `source`, `occurrence_id`.

Aucune donnee existante n'est modifiee.

## Diagnostic lecture seule

`backend/scripts/diagnose-quality-canonical-execution.js <store_id>`

Le diagnostic remonte:

- records temperature/nettoyage sans occurrence;
- records avec tache mais sans occurrence;
- occurrences completees sans record source;
- doublons de records par occurrence;
- echantillon des occurrences completees non rattachees.

Le mode `--apply` est volontairement refuse.

## MCP

Le catalogue reste en version `1.8.4`.

Les outils publics operationnels continuent d'utiliser les services metier:

- `execute_quality_temperature_occurrence`;
- `execute_quality_cleaning_occurrence`;
- `execute_quality_manual_occurrence`;
- `get_quality_today_work`;
- `get_quality_overdue_work`;
- `get_quality_ddpp_dashboard`.
- `get_quality_ddpp_record_detail`.

Le total public verifie est `181` outils, avec `coverage_complete: true` et `missing_tools: []`.

## Verification

```bash
node --check backend/services/quality/operations.js
node --check backend/services/quality/temperatures.js
node --check backend/services/quality/cleaning.js
node --check backend/routes/quality/temperatures.js
node --check backend/routes/quality/cleaning.js
node --check backend/scripts/diagnose-quality-canonical-execution.js
node --check frontend/quality/js/quality-execution-forms.js
node --check frontend/quality/js/temperature-records.js
node --check frontend/quality/js/cleaning-records.js
node --check frontend/quality/js/quality-today.js
node backend/scripts/test-quality-operational-workstation.js
node backend/scripts/test-agent-tool-registry.js
node backend/scripts/test-agent-permissions-context.js
node backend/scripts/test-quality-agent-configuration-tools.js
node backend/scripts/test-quality-router-startup.js
node backend/scripts/test-mcp-public-tools-list.js
node backend/scripts/test-agent-mcp-coverage-matrix.js
node backend/scripts/test-quality-temperature-type-mcp-tools.js
node backend/scripts/test-quality-cleaning-plan-multi-targets.js
node backend/scripts/test-quality-cleaning-plan-form-selection.js
```

## Commandes VPS apres merge

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
psql "$DATABASE_URL" -f backend/db/gestion-commerciale/068_quality_operational_workstation.sql
psql "$DATABASE_URL" -f backend/db/gestion-commerciale/069_quality_manual_execution_records.sql
psql "$DATABASE_URL" -f backend/db/gestion-commerciale/070_quality_canonical_execution_sources.sql
node backend/scripts/diagnose-quality-canonical-execution.js <store_id>
pm2 restart gestion-commerciale
```
