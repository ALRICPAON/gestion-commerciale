# ALTA MARÉE - Module Qualité QMS

## Vision

Le module Qualité QMS doit faire d'ALTA MARÉE le système qualité intégré de l'entreprise, au-delà de l'ERP commercial. L'objectif est de permettre à un mareyeur, grossiste, atelier de préparation ou transformateur de gérer son PMS, ses preuves qualité, ses inspections et son amélioration continue directement dans ALTA MARÉE.

## État actuel

Le socle QMS est en place et le premier sous-module métier est en cours : le jumeau numérique de l'atelier, centré sur les zones qualité et les équipements qualité.

## Historique des PR Qualité

- PR #170 — QMS Foundation : socle backend/frontend, permissions, services communs, placeholder Qualité.
- PR Q1 — Jumeau numérique atelier : zones et équipements qualité.

## PR en cours

PR Q1 — Jumeau numérique atelier.

Périmètre : zones qualité, équipements qualité, premières tables SQL métier QMS, pages frontend de gestion zones et équipements, mise à jour du présent README.

Hors périmètre : nettoyage, températures, maintenance, étalonnage, audits, non-conformités, HACCP, QR codes, plan graphique interactif.

## Roadmap synthétique

1. Q0 — Fondation QMS.
2. Q1 — Jumeau numérique atelier : zones et équipements.
3. Q2 — Nettoyage et désinfection rattachés aux zones/équipements.
4. Q3 — Températures et contrôles froid.
5. Q4 — Maintenance et étalonnages.
6. Q5 — Non-conformités et actions correctives.
7. Q6 — Audits, inspections DDPP et exports.
8. Q7 — QR codes et accès mobile atelier.
9. Q8 — IA Qualité et analyse des tendances.

## Architecture backend

Namespace API : `/api/quality`.

Dossiers : `backend/routes/quality/`, `backend/services/quality/`, `backend/middleware/quality/`, `backend/validators/quality/`, `backend/pdf/quality/`.

Q1 ajoute : `backend/routes/quality/zones.js`, `backend/routes/quality/equipments.js`, `backend/services/quality/digitalTwin.js`, `backend/validators/quality/digitalTwin.js`.

## Architecture frontend

Dossier produit : `frontend/quality/`.

Sous-dossiers : `pages`, `components`, `js`, `css`, `assets`.

Q1 ajoute : page zones qualité, page équipements qualité, client API frontend du jumeau numérique, lien depuis le tableau de bord Qualité.

## Permissions qualité

- `quality.read`
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

## Tables SQL créées

Q1 : `quality_zones`, `quality_equipments`.

Toutes les tables métier QMS doivent être liées à `store_id`.

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

## Pages frontend disponibles

- `frontend/quality/pages/dashboard.html`
- `frontend/quality/pages/zones.html`
- `frontend/quality/pages/equipments.html`

## Décisions importantes

- Le module Qualité est conçu comme un produit autonome dans ALTA MARÉE.
- Les modules achats, ventes, stock, BL, factures, comptabilité, Pennylane, WhatsApp et IA existante ne doivent pas être modifiés pour Q1.
- Le jumeau numérique sert de socle aux futurs modules nettoyage, températures, maintenance, étalonnage, QR codes et inspection.
- Les zones archivées et équipements archivés ne doivent plus apparaître par défaut.
- Une zone liée à un équipement ne doit pas être supprimée physiquement : elle est archivée.

## Règles de non-régression

À chaque PR Qualité, vérifier au minimum : login, home, carte Qualité, page Qualité, Articles, Clients, Fournisseurs, Achats, Ventes, BL, Stock, Pennylane.

## Prochaines PR prévues

PR Q2 recommandée : nettoyage et désinfection rattachés aux zones et équipements.

Alternative possible : températures si la chambre froide doit être priorisée avant le nettoyage.
