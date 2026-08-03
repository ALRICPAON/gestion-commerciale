# Correctif poste operationnel qualite

## Cause exacte

La PR #225 a pose le poste operationnel, mais plusieurs flux restaient incomplets.

- Les taches `MANUAL` etaient terminees par `quality_tasks.status` et `quality_task_history` uniquement.
- La section `Realises aujourd'hui` et le DDPP etaient reconstruits depuis `quality_temperature_records` et `quality_cleaning_records`.
- Une tache manuelle terminee n'avait donc aucun enregistrement metier a afficher dans ces vues: elle sortait des taches a faire sans apparaitre dans les realises.
- Les formulaires front etaient conditionnels mais trop pauvres: pas de controle visuel, preuve, operateur affiche, conformite manuelle, methode temperature, ni validation explicite des cas obligatoires.
- Les executions temperature/nettoyage creaient bien un record, mais l'occurrence etait completee hors de la transaction propre au record.
- Les anciennes routes de saisie temperature/nettoyage et le MCP pouvaient diverger du poste `Qualite du jour`.

## Correction

Le correctif introduit une trace dediee:

`quality_manual_task_records`

Elle conserve:

- tache manuelle;
- occurrence;
- date/heure;
- operateur;
- resultat;
- conformite;
- observation;
- action corrective;
- preuve photo/document.

Les realises du jour et le DDPP utilisent maintenant `quality_task_occurrences` comme socle, puis enrichissent chaque ligne avec le record source:

- `quality_temperature_record`;
- `quality_cleaning_record`;
- `quality_manual_task_record`.

Les taches `SYSTEM` verrouillees restent bloquees en completion directe. Elles passent par leur formulaire metier.

## Fonctionnel reel apres correction

- Temperature: valeur obligatoire, record temperature cree, occurrence completee, operateur relie, preuve/methode acceptees.
- Nettoyage: record nettoyage cree, controle visuel et anomalie acceptes, justification obligatoire si non realise/anomalie, occurrence completee.
- Manuel: trace dediee creee, occurrence completee, visible dans `Realises aujourd'hui` et DDPP.
- DDPP: historique du jour agrege depuis les occurrences completees, avec filtres date/type et impression.
- Dashboard: premier niveau simplifie entre execution, controle, configuration et referentiels.
- Routes historiques et MCP: les creations temperature/nettoyage passent par les services canoniques `recordTemperatureControl` et `recordCleaningExecution`.
- Controles evenementiels: les taches `frequency_unit = events` sont affichees dans une section dediee et ne polluent pas les retards ou l'a venir.

## Migrations

- `068_quality_operational_workstation.sql`: occurrences, NC, actions correctives, liens execution.
- `069_quality_manual_execution_records.sql`: traces d'execution des taches manuelles.
- `070_quality_canonical_execution_sources.sql`: source et motif exceptionnel des executions canoniques.

Les deux migrations sont additives et idempotentes. Aucune donnee existante n'est modifiee.

## Commandes de verification

```bash
node --check backend/services/quality/operations.js
node --check backend/services/quality/temperatures.js
node --check backend/services/quality/cleaning.js
node --check backend/routes/quality/temperatures.js
node --check backend/routes/quality/cleaning.js
node --check backend/scripts/diagnose-quality-canonical-execution.js
node --check backend/services/agent/agentToolRegistry.js
node --check frontend/quality/js/quality-execution-forms.js
node --check frontend/quality/js/quality-today.js
node --check frontend/quality/js/quality-ddpp.js
node backend/scripts/test-quality-operational-workstation.js
node backend/scripts/test-agent-mcp-coverage-matrix.js
node backend/scripts/test-mcp-public-tools-list.js
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

## Verification schema

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_name IN (
  'quality_task_occurrences',
  'quality_manual_task_records',
  'quality_non_conformities',
  'quality_corrective_actions'
)
ORDER BY table_name;
```
