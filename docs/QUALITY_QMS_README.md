# ALTA MARÉE - Module Qualité QMS

## Vision

Le module Qualité QMS doit faire d'ALTA MARÉE le système qualité intégré de l'entreprise, au-delà de l'ERP commercial. L'objectif est de permettre à un mareyeur, grossiste, atelier de préparation ou transformateur de gérer son PMS, ses preuves qualité, ses inspections et son amélioration continue directement dans ALTA MARÉE.

Chaque sous-module Qualité doit être conçu comme un produit autonome, mais parfaitement intégré à l'ERP existant.

## État actuel

Le socle QMS est en place. Le jumeau numérique de l'atelier existe avec les zones qualité et les équipements qualité. La PR Q2 ajoute le dossier documentaire de ces objets : photos et documents rattachés aux zones et équipements.

## Historique des PR Qualité

- PR #170 — QMS Foundation : socle backend/frontend, permissions, services communs, placeholder Qualité.
- PR #171 — Jumeau numérique atelier : zones et équipements qualité.
- PR Q2 — Dossiers documentaires : photos et documents rattachés aux zones et équipements qualité.

## PR en cours

PR Q2 — Dossiers documentaires du jumeau numérique.

Périmètre : tables génériques de documents/photos, routes API documents/photos, page frontend de dossier documentaire, accès depuis les zones et équipements, mise à jour du présent README.

Hors périmètre : nettoyage, températures, maintenance métier, étalonnage, audits, non-conformités, HACCP, QR codes, plan graphique interactif.

## Roadmap synthétique

1. Q0 — Fondation QMS.
2. Q1 — Jumeau numérique atelier : zones et équipements.
3. Q2 — Dossiers documentaires : photos et documents.
4. Q3 — Nettoyage et désinfection rattachés aux zones/équipements.
5. Q4 — Températures et contrôles froid.
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

## Architecture frontend

Dossier produit : `frontend/quality/`.

Sous-dossiers : `pages`, `components`, `js`, `css`, `assets`.

Q1 ajoute : page zones qualité, page équipements qualité, client API frontend du jumeau numérique, lien depuis le tableau de bord Qualité.

Q2 ajoute : page `frontend/quality/pages/documents.html` et script `frontend/quality/js/documents.js`, accessibles depuis les cartes Zone et Équipement.

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

Q2 utilise `quality.read`, `quality.document.manage` et `quality.admin`.

## Tables SQL créées

Q1 :
- `quality_zones`
- `quality_equipments`

Q2 :
- `quality_document_types`
- `quality_documents`
- `quality_photos`

Toutes les tables métier QMS doivent être liées à `store_id`.

Le modèle documentaire Q2 conserve `owner_type` et `owner_id` afin de pouvoir être étendu plus tard à d'autres objets QMS : audits, maintenance, HACCP, CAPA, inspections, crises sanitaires.

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
- `POST /api/quality/documents`
- `GET /api/quality/documents/:id/download`
- `DELETE /api/quality/documents/:id`

Photos :
- `GET /api/quality/photos`
- `POST /api/quality/photos`
- `GET /api/quality/photos/:id/file`
- `DELETE /api/quality/photos/:id`

## Pages frontend disponibles

- `frontend/quality/pages/dashboard.html`
- `frontend/quality/pages/zones.html`
- `frontend/quality/pages/equipments.html`
- `frontend/quality/pages/documents.html`

## Décisions importantes

- Le module Qualité est conçu comme un produit autonome dans ALTA MARÉE.
- Les modules achats, ventes, stock, BL, factures, comptabilité, Pennylane, WhatsApp et IA existante ne doivent pas être modifiés pour Q2.
- Le jumeau numérique sert de socle aux futurs modules nettoyage, températures, maintenance, étalonnage, QR codes et inspection.
- Les zones archivées et équipements archivés ne doivent plus apparaître par défaut.
- Une zone liée à un équipement ne doit pas être supprimée physiquement : elle est archivée.
- Les documents et photos supprimés sont archivés afin de conserver l'historique qualité.
- Les fichiers Q2 sont rattachés à une zone ou un équipement, mais la structure `owner_type` / `owner_id` prépare l'extension aux futurs objets QMS.

## Règles de non-régression

À chaque PR Qualité, vérifier au minimum : login, home, carte Qualité, page Qualité, Articles, Clients, Fournisseurs, Achats, Ventes, BL, Stock, Pennylane.

Ne pas modifier les calculs commerciaux, achats, ventes, BL, factures, stock/FIFO, comptabilité, Pennylane, WhatsApp, catalogue ou IA existante sans nécessité explicite.

## Prochaines PR prévues

PR Q3 recommandée : nettoyage et désinfection rattachés aux zones et équipements.

Alternative possible : températures si la chambre froide doit être priorisée avant le nettoyage.
