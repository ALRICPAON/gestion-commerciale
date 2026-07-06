# Complément PR Q4.1 - Moteur générique des tâches Qualité

## PR en cours

PR Q4.1 - Moteur générique des tâches Qualité (Foundation).

Périmètre : tables génériques `quality_tasks` et `quality_task_history`, service central `backend/services/quality/taskScheduler.js`, API REST `/api/quality/tasks`, page `frontend/quality/pages/quality-tasks.html`, compteurs de planification sur le dashboard Qualité.

Hors périmètre : nettoyage, maintenance, HACCP, audits, QR codes, notifications, emails, tâches automatiques et cron.

## Architecture du moteur

Le moteur repose sur une tâche générique rattachée à un magasin via `store_id` et à un module via `module_key`.

Le couple `entity_type` / `entity_id` permet de rattacher une tâche à n'importe quel objet QMS futur sans modifier la structure :
- zone
- équipement
- audit
- plan HACCP
- étalonnage
- action corrective

`entity_id` ne porte volontairement pas de clé étrangère afin de rester polymorphe. La seule clé étrangère utilisateur est `responsible_user_id`.

La logique de date, retard et statut est centralisée dans `backend/services/quality/taskScheduler.js`. Les futurs modules devront appeler ce service au lieu de dupliquer le calcul.

## Tables

`quality_tasks` :
- tâche générique par magasin
- `module_key` pour filtrer par module (`temperature`, `cleaning`, `maintenance`, `audit`, `haccp`, etc.)
- rattachement polymorphe `entity_type` / `entity_id`
- responsable optionnel
- fréquence, heure cible, prochaine échéance
- statut, actif, dates de création et mise à jour

`quality_task_history` :
- historique d'audit des validations et changements de statut
- utilisateur
- date de validation
- commentaire
- statut
- ancienne échéance
- nouvelle échéance

## Routes

- `GET /api/quality/tasks`
- `GET /api/quality/tasks/summary`
- `GET /api/quality/tasks/:id`
- `POST /api/quality/tasks`
- `PUT /api/quality/tasks/:id`
- `PATCH /api/quality/tasks/:id/status`
- `DELETE /api/quality/tasks/:id`

Le `DELETE` est une désactivation logique : `active=false` et `status='paused'`.

## Logique de fonctionnement

À la création ou modification, si `next_due_at` n'est pas fourni, le service calcule la prochaine échéance depuis la fréquence et l'heure cible.

Les statuts calculés sont :
- `planned` : tâche active avec échéance future
- `due` : tâche active due aujourd'hui
- `overdue` : tâche active avec échéance passée
- `paused` : tâche inactive

Lors d'un passage à `completed`, une ligne d'historique est créée, `last_completed_at` est renseigné, et la prochaine échéance est recalculée si une fréquence existe.

## Réutilisation future

Chaque futur module QMS devra :
- créer ses objets métier propres si nécessaire
- créer ou mettre à jour ses tâches génériques dans `quality_tasks`
- utiliser `module_key` pour filtrer ses tâches
- utiliser `entity_type` / `entity_id` pour rattacher la tâche à son objet métier
- déléguer les calculs à `taskScheduler.js`

Cette fondation évite de créer un moteur de planification différent pour températures, nettoyage, maintenance, étalonnages, HACCP, audits ou actions correctives.
