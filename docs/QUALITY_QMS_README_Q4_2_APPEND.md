# Complément PR Q4.2 - Températures liées au moteur de tâches

## Objectif

Le moteur `quality_tasks` devient la source officielle de planification des relevés température.

Le découpage est désormais :
- paramètre température : règle métier, seuils, type, zone/équipement, actif
- tâche qualité : fréquence, heure cible, prochaine échéance, responsable, statut
- relevé température : preuve réalisée et historique métier température

## Migration

La migration `049_temperature_limits_quality_tasks.sql` ajoute :
- `quality_temperature_limits.quality_task_id uuid`
- une clé étrangère vers `quality_tasks(id)` avec `ON DELETE SET NULL`
- un index sur `quality_task_id`

La migration est additive et idempotente. Les anciennes colonnes `expected_frequency_value`, `expected_frequency_unit` et `target_time` restent présentes pour compatibilité legacy, mais la source officielle devient la tâche qualité liée.

## Fonctionnement

Dans Paramètres Températures, l'utilisateur peut :
- sélectionner une tâche qualité existante filtrée sur `module_key = temperature`
- créer une nouvelle tâche qualité depuis le formulaire
- laisser le paramètre non planifié

Lorsqu'une tâche est créée depuis le formulaire température :
- `module_key = temperature`
- `entity_type = equipment` si un équipement est choisi
- `entity_type = zone` si une zone est choisie sans équipement
- `entity_id` reprend l'id de la zone ou de l'équipement

Lorsqu'un nouveau relevé température correspond à un paramètre lié à une tâche :
- le relevé est enregistré comme avant
- `quality_task_history` reçoit une ligne de validation
- `last_completed_at` est mis à jour
- `next_due_at` est recalculé par `taskScheduler.js`

Le module Températures ne duplique plus la logique de retard et prochaine échéance.
