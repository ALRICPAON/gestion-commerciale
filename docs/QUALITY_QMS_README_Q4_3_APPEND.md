# Complément PR Q4.3 - Relevés température attendus

## Objectif

Les opérateurs ne doivent plus deviner les contrôles température attendus.

La page Relevés Température affiche désormais les relevés attendus issus des tâches qualité liées aux paramètres température.

## Source officielle

`quality_tasks` reste la source officielle :
- fréquence
- heure cible
- prochaine échéance
- statut calculé
- retard

`quality_temperature_limits.quality_task_id` relie la règle métier température à la tâche de planification.

## API

Nouvelle route :

- `GET /api/quality/temperatures/due-readings`

Par défaut, la route retourne uniquement :
- les tâches température actives en retard
- les tâches température actives dues aujourd'hui

Le filtre `include_upcoming=true` permet d'inclure les tâches futures.

Chaque ligne contient le paramètre température, le type, la zone, l'équipement, les seuils, le titre de tâche, l'heure cible, la prochaine échéance, le statut calculé et la dernière complétion.

## UX Relevés Température

La page Relevés Température ajoute une section `Relevés attendus`.

L'opérateur voit :
- quoi relever
- où relever
- à quelle heure
- si le relevé est en retard ou dû aujourd'hui

Le bouton `Faire le relevé` préremplit le formulaire manuel avec :
- type de température
- zone
- équipement
- tâche qualité en contexte

La saisie manuelle reste disponible pour les cas exceptionnels.

Après enregistrement, le mécanisme Q4.2 complète la tâche liée, écrit l'historique qualité et recalcule `next_due_at`.
