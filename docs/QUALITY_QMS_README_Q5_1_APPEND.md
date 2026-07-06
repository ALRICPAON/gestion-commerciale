# Complément PR Q5.1 - Cleaning & Disinfection Foundation

## Objectif

Q5.1 introduit la fondation Nettoyage & Désinfection en réutilisant le moteur générique `quality_tasks`.

Le module ne crée pas de planning parallèle.

## Architecture

Le découpage est :
- plan de nettoyage : règle métier nettoyage
- tâche qualité : planification officielle, fréquence, heure cible, échéance, retard
- enregistrement nettoyage : preuve réalisée

## Tables

`quality_cleaning_plans` contient les règles métier :
- titre et description
- rattachement zone ou équipement
- produit utilisé
- méthode
- consignes sécurité
- durée prévue
- lien optionnel `quality_task_id`
- actif, audit de création et mise à jour

`quality_cleaning_records` contient les preuves :
- plan réalisé
- tâche qualité liée si disponible
- date de réalisation
- utilisateur
- statut : `done`, `partial`, `not_done`, `issue`
- commentaire

## API

Plans :
- `GET /api/quality/cleaning/plans`
- `GET /api/quality/cleaning/plans/:id`
- `POST /api/quality/cleaning/plans`
- `PUT /api/quality/cleaning/plans/:id`
- `PATCH /api/quality/cleaning/plans/:id/status`

Réalisation :
- `GET /api/quality/cleaning/due-records`
- `POST /api/quality/cleaning/records`
- `GET /api/quality/cleaning/records`

Synthèse dashboard :
- `GET /api/quality/cleaning/summary`

## Fonctionnement

Un plan peut être non planifié, lié à une tâche `module_key = cleaning` existante, ou créer une nouvelle tâche qualité depuis l'interface.

Les nettoyages attendus proviennent uniquement des tâches qualité liées à des plans actifs.

Lorsqu'un nettoyage est enregistré avec une tâche liée :
- une ligne `quality_cleaning_records` est créée
- une ligne `quality_task_history` est créée
- `last_completed_at` est mis à jour
- `next_due_at` est recalculé par `taskScheduler.js`

La saisie manuelle reste possible pour les cas exceptionnels.
