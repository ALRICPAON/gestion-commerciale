# ALTA MARÉE - Module Qualité QMS

## Vision

Le module Qualité QMS doit faire d'ALTA MARÉE le système qualité intégré de l'entreprise, au-delà de l'ERP commercial. L'objectif est de permettre à un mareyeur, grossiste, atelier de préparation ou transformateur de gérer son PMS, ses preuves qualité, ses inspections et son amélioration continue directement dans ALTA MARÉE.

Chaque sous-module Qualité doit être conçu comme un produit autonome, mais parfaitement intégré à l'ERP existant.

## État actuel

Le socle QMS est en place. Le jumeau numérique de l'atelier existe avec les zones qualité et les équipements qualité. Les dossiers documentaires permettent de rattacher photos et documents aux zones et équipements. La PR Q3 ajoute le premier module réglementaire : températures et chaîne du froid, avec deux écrans distincts Paramètres/Relevés, saisie manuelle, limites configurables, fréquences attendues, détection des relevés manquants, alertes simples, historique, synthèse et préparation IoT.

## Historique des PR Qualité

- PR #170 — QMS Foundation : socle backend/frontend, permissions, services communs, placeholder Qualité.
- PR #171 — Jumeau numérique atelier : zones et équipements qualité.
- PR Q2 — Dossiers documentaires : photos et documents rattachés aux zones et équipements qualité, archives consultables et restaurables.
- PR Q3 — Températures & chaîne du froid : paramètres de suivi, fréquences attendues, relevés, alertes, relevés manquants, historique, graphiques simples et architecture prête pour IoT/import/API.

## PR en cours

PR Q3 — Températures & chaîne du froid.

Périmètre : tables de types/paramètres/relevés de température, routes API températures, pages frontend Paramètres Températures et Relevés Températures, synthèse sur le tableau de bord Qualité, export CSV, préparation des sources manuel/IoT/import/API.

Hors périmètre : nettoyage, maintenance métier, étalonnage, audits, non-conformités, HACCP, QR codes, IA Qualité, intégration réelle de sondes IoT.

## Roadmap synthétique

1. Q0 — Fondation QMS.
2. Q1 — Jumeau numérique atelier : zones et équipements.
3. Q2 — Dossiers documentaires : photos et documents.
4. Q3 — Températures et contrôles froid.
5. Q4 — Nettoyage et désinfection rattachés aux zones/équipements.
6. Q5 — Maintenance et étalonnages.
7. Q6 — Non-conformités, actions correctives et CAPA.
8. Q7 — Audits, inspections DDPP et exports.
9. Q8 — QR codes et accès mobile atelier.
10. Q9 — IA Qualité et analyse des tendances.

## Architecture backend

Namespace API : `/api/quality`.

Dossiers : `backend/routes/quality/`, `backend/services/quality/`, `backend/middleware/quality/`, `backend/validators/quality/`, `backend/pdf/quality/`.

Q1 ajoute : `backend/routes/quality/zones.js`, `backend/routes/quality/equipments.js`, `backend/services/quality/digitalTwin.js`, `backend/validators/quality/digitalTwin.js`.

Q2 ajoute : `backend/routes/quality/documents.js`, `backend/services/quality/documents.js`, `backend/validators/quality/documents.js`.

Q3 ajoute : `backend/routes/quality/temperatures.js`, `backend/services/quality/temperatures.js`, `backend/validators/quality/temperatures.js`.

## Architecture frontend

Dossier produit : `frontend/quality/`.

Sous-dossiers : `pages`, `components`, `js`, `css`, `assets`.

Q1 ajoute : page zones qualité, page équipements qualité, client API frontend du jumeau numérique, lien depuis le tableau de bord Qualité.

Q2 ajoute : page `frontend/quality/pages/documents.html` et script `frontend/quality/js/documents.js`, accessibles depuis les cartes Zone et Équipement.

Q3 ajoute : pages `frontend/quality/pages/temperature-settings.html`, `frontend/quality/pages/temperature-records.html`, page d'orientation `frontend/quality/pages/temperatures.html`, scripts `frontend/quality/js/temperature-settings.js` et `frontend/quality/js/temperature-records.js`, client `frontend/quality/js/temperature-api.js`, synthèse températures sur le tableau de bord Qualité.

## Permissions qualité

- `quality.read`
- `quality.configuration.write`
- `quality.record.create`
- `quality.equipment.manage`
- `quality.nc.manage`
- `quality.action.manage`
- `quality.audit.manage`
- `quality.crisis.manage`
- `quality.document.manage`
- `quality.inspection.export`
- `quality.ai.use`
- `quality.admin`

Q1 utilise `quality.read`, `quality.equipment.manage` et `quality.admin`.

Q2 utilise `quality.read`, `quality.document.manage` et `quality.admin`.

Q3 utilise `quality.read`, `quality.record.create`, `quality.equipment.manage` et `quality.admin`.

## Tables SQL créées

Q1 :
- `quality_zones`
- `quality_equipments`

Q2 :
- `quality_document_types`
- `quality_documents`
- `quality_photos`

Q3 :
- `quality_temperature_types`
- `quality_temperature_limits`
- `quality_temperature_records`

Toutes les tables métier QMS doivent être liées à `store_id`.

Le modèle documentaire Q2 conserve `owner_type` et `owner_id` afin de pouvoir être étendu plus tard à d'autres objets QMS : audits, maintenance, HACCP, CAPA, inspections, crises sanitaires.

Le modèle températures Q3 conserve la source du relevé (`manual`, `iot`, `import`, `api`) afin de permettre l'arrivée future de sondes connectées, imports ou intégrations API sans refonte.

## Endpoints disponibles

Fondation :
- `GET /api/quality/foundation`
- `GET /api/quality/permissions`

Zones :
- `GET /api/quality/zones`
- `GET /api/quality/zones/:id`
- `POST /api/quality/zones`
- `PUT /api/quality/zones/:id`
- `PATCH /api/quality/zones/:id/status`
- `DELETE /api/quality/zones/:id`

Équipements :
- `GET /api/quality/equipments`
- `GET /api/quality/equipments/:id`
- `POST /api/quality/equipments`
- `PUT /api/quality/equipments/:id`
- `PATCH /api/quality/equipments/:id/status`
- `DELETE /api/quality/equipments/:id`

Documents :
- `GET /api/quality/documents`
- `GET /api/quality/documents?include_archived=true`
- `POST /api/quality/documents`
- `GET /api/quality/documents/:id/download`
- `PATCH /api/quality/documents/:id/restore`
- `DELETE /api/quality/documents/:id`

Photos :
- `GET /api/quality/photos`
- `GET /api/quality/photos?include_archived=true`
- `POST /api/quality/photos`
- `GET /api/quality/photos/:id/file`
- `PATCH /api/quality/photos/:id/restore`
- `DELETE /api/quality/photos/:id`

Températures :
- `GET /api/quality/temperatures/types`
- `GET /api/quality/temperatures/limits`
- `POST /api/quality/temperatures/limits`
- `PUT /api/quality/temperatures/limits/:id`
- `DELETE /api/quality/temperatures/limits/:id`
- `GET /api/quality/temperatures/summary`
- `GET /api/quality/temperatures`
- `GET /api/quality/temperatures/:id`
- `POST /api/quality/temperatures`
- `PUT /api/quality/temperatures/:id`
- `DELETE /api/quality/temperatures/:id`

## Pages frontend disponibles

- `frontend/quality/pages/dashboard.html`
- `frontend/quality/pages/zones.html`
- `frontend/quality/pages/equipments.html`
- `frontend/quality/pages/documents.html`
- `frontend/quality/pages/temperatures.html`
- `frontend/quality/pages/temperature-settings.html`
- `frontend/quality/pages/temperature-records.html`

## Décisions importantes

- Le module Qualité est conçu comme un produit autonome dans ALTA MARÉE.
- Les modules achats, ventes, stock, BL, factures, comptabilité, Pennylane, WhatsApp et IA existante ne doivent pas être modifiés pour Q3.
- Le jumeau numérique sert de socle aux futurs modules nettoyage, températures, maintenance, étalonnage, QR codes et inspection.
- Les zones archivées et équipements archivés ne doivent plus apparaître par défaut.
- Une zone liée à un équipement ne doit pas être supprimée physiquement : elle est archivée.
- Les documents et photos supprimés sont archivés afin de conserver l'historique qualité.
- Les documents et photos archivés sont masqués par défaut, consultables via `include_archived=true`, et restaurables sans suppression définitive.
- Les fichiers Q2 sont rattachés à une zone ou un équipement, mais la structure `owner_type` / `owner_id` prépare l'extension aux futurs objets QMS.
- Les limites de température ne sont pas codées en dur : elles sont configurables par magasin, type, zone et/ou équipement.
- Les paramètres de température portent une fréquence attendue (`hours`, `days`, `events`) afin de détecter les relevés manquants ou en retard.
- Les alertes températures Q3 restent simples : conforme, surveillance, hors limites. Les actions correctives arriveront dans une PR dédiée.
- La synthèse température doit compter les relevés hors limites et les relevés manquants selon les paramètres actifs.
- Les relevés températures sont préparés pour plusieurs sources : manuel, IoT, import et API. Q3 ne contient aucune intégration IoT réelle.

## Règles de non-régression

À chaque PR Qualité, vérifier au minimum : login, home, carte Qualité, page Qualité, Articles, Clients, Fournisseurs, Achats, Ventes, BL, Stock, Pennylane.

Ne pas modifier les calculs commerciaux, achats, ventes, BL, factures, stock/FIFO, comptabilité, Pennylane, WhatsApp, catalogue ou IA existante sans nécessité explicite.

## Prochaines PR prévues

PR Q4 recommandée : nettoyage et désinfection rattachés aux zones et équipements.

PR Q5 recommandée : maintenance et étalonnages des équipements.
## Agent ALTA_MAREE_V3 - configuration Qualite

La permission dediee `quality.configuration.write` permet a l'agent de configurer le module Qualite sans droits de suppression generale.

Elle autorise la creation/modification de taches qualite non executees, la creation/modification de plans de nettoyage, les associations aux zones/equipements du meme magasin, la definition de frequences, responsables, roles, methodes, criticite, preuves attendues, puis l'activation ou desactivation logique.

Elle n'autorise pas la suppression physique de zones, equipements, releves, historiques, audits, non-conformites ou preuves, ni la modification d'une tache deja executee ou d'un enregistrement operationnel valide.

Workflow:

- creations agent marquees `created_source='agent_alta'`, `created_by_agent=true`;
- creations agent par defaut en `pending_review` et `active=false`;
- validation, activation, desactivation ou archivage par action explicite;
- activation refusee pour un plan incomplet sans produit, dosage/concentration, temps de contact ou frequence portee par le plan.

Tables et migration:

- `quality_cleaning_plans` est la source de verite PMS des plans de nettoyage, y compris perimetre, responsable, frequence, heure cible, duree, methode, preuves et actions correctives;
- `quality_tasks` reste le moteur d'execution et d'echeance; pour le nettoyage, il est synchronise depuis `quality_cleaning_plans` et ne porte pas une saisie concurrente;
- les executions temperature et nettoyage passent par des services canoniques partages par Qualite du jour, les anciennes routes et MCP;
- `quality_cleaning_plan_zones` et `quality_cleaning_plan_equipments` portent les associations multi-zones et multi-equipements des plans;
- `quality_zones` et `quality_equipments` restent les sources du jumeau numerique;
- `063_quality_configuration_agent_write.sql` ajoute uniquement des colonnes optionnelles, contraintes de statut et index;
- `064_quality_cleaning_plan_multi_targets.sql` est additive, idempotente et backfill les liaisons depuis `zone_id` et `equipment_id`.
- `068_quality_operational_workstation.sql` ajoute les occurrences operationnelles, non-conformites, actions correctives et liens de preuve sans modifier les donnees existantes.
- `069_quality_manual_execution_records.sql` ajoute la trace exploitable des executions de taches manuelles.
- `070_quality_canonical_execution_sources.sql` ajoute les champs de source et de motif exceptionnel necessaires aux executions canoniques.

Compatibilite plans de nettoyage:

- `zone_id` et `equipment_id` restent acceptes et retournes;
- `zone_ids` et `equipment_ids` permettent de couvrir plusieurs zones et equipements dans un seul plan PMS;
- les lectures retournent `zones: []` et `equipments: []`;
- toute creation/modification/activation/desactivation de plan synchronise automatiquement la tache qualite liee via `quality_task_id`;
- les taches generees depuis un plan conservent une cible legacy principale et decrivent le perimetre complet;
- les parametres temperature et leurs taches restent independants.

Poste operationnel:

- `Qualite du jour` centralise les controles attendus, retards, prochains controles, realises du jour et non-conformites ouvertes;
- `Controle DDPP` fournit une vue lecture seule pour inspection avec statut vert/orange/rouge;
- une tache `SYSTEM` verrouillee ne peut plus etre terminee directement: elle doit produire un releve temperature ou un enregistrement nettoyage;
- `quality_task_occurrences` garde chaque echeance reelle sans ecraser l'historique.
- une tache `MANUAL` realisee cree maintenant une ligne `quality_manual_task_records`; elle apparait dans `Realises aujourd'hui` et dans le DDPP.
- une saisie temperature ou nettoyage sans occurrence est une saisie exceptionnelle et exige un motif.
- les controles `frequency_unit = events` sont affiches dans une section dediee et ne sont pas consideres comme dus, en retard ou a venir.

Outils MCP:

- `quality_create_task`;
- `quality_update_task`;
- `quality_create_cleaning_plan`;
- `quality_update_cleaning_plan`;
- `quality_assign_task_to_zone`;
- `quality_assign_task_to_equipment`;
- `quality_activate_configuration`;
- `quality_deactivate_configuration`.
- `get_quality_today_work`;
- `get_quality_overdue_work`;
- `get_quality_ddpp_dashboard`;
- `get_quality_ddpp_record_detail`;
- `execute_quality_temperature_occurrence`;
- `execute_quality_cleaning_occurrence`;
- `execute_quality_manual_occurrence`;
- `create_quality_non_conformity`;
- `create_quality_corrective_action`;
- `close_quality_non_conformity`.

Exemple MCP:

```json
{
  "jsonrpc": "2.0",
  "id": 10,
  "method": "tools/call",
  "params": {
    "name": "quality_create_task",
    "arguments": {
      "title": "Controle nettoyage vivier",
      "category": "viviers",
      "zone_id": "<ZONE_ID>",
      "frequency_value": 1,
      "frequency_unit": "days",
      "responsible_role": "qualite",
      "criticality": "high"
    }
  }
}
```

Tests:

```bash
node backend/scripts/test-agent-tool-registry.js
node backend/scripts/test-agent-permissions-context.js
node backend/scripts/test-quality-agent-configuration-tools.js
node backend/scripts/test-mcp-public-tools-list.js
node backend/scripts/test-quality-router-startup.js
```
# Architecture PMS Qualite

Les plans de nettoyage et les parametres temperature sont des sources de verite metier. Une tache qualite liee a l'une de ces sources est generee automatiquement avec `task_origin=SYSTEM`, `source_entity_type`, `source_entity_id` et `source_locked=true`.

Les taches manuelles gardent `task_origin=MANUAL`. Elles restent modifiables directement si elles n'ont pas d'historique et si l'utilisateur possede les permissions de configuration. Une tache systeme verrouillee doit etre modifiee depuis sa source native afin de conserver la synchronisation PMS.

Les anciennes taches temperature QF-01..QF-13 ne sont pas supprimees automatiquement. Le diagnostic lecture seule se lance avec:

```bash
node backend/scripts/diagnose-quality-legacy-qf-tasks.js <STORE_ID>
```

Il produit la recommandation attach/keep/archive/logical delete sans modifier la base.
