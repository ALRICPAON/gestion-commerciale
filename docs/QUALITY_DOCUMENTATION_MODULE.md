# Module Documentation Qualite

## Architecture

Le module est expose sur `/quality/pages/documentation.html` et consomme les routes `/api/quality/documentation`.
Il reutilise l'authentification existante, le `store_id` du token, les permissions Qualite et le rendu PDF Puppeteer deja present dans `backend/services/pdf/pdfRenderer.js`.

## Tables

Migration idempotente : `backend/db/gestion-commerciale/20260713_quality_documentation.sql`.

Tables creees :

- `quality_documentation_collections`
- `quality_documentation_sections`
- `quality_documentation_versions`
- `quality_documentation_missing_items`
- `quality_documentation_attachments`
- `quality_documentation_exports`

Toutes les tables portent `store_id` et les requetes filtrent par le magasin connecte.

## Services

- `qualityDocumentationTemplateService` initialise les 9 tomes et les chapitres par defaut.
- `qualityDocumentationService` gere collections, sections, informations manquantes et tableau de bord.
- `qualityDocumentationVersionService` historise les modifications et restaure une version.
- `qualityDocumentationExportService` rend le HTML qualite et genere le PDF cote serveur.
- `companyIdentityService` lit l'identite entreprise depuis `store_settings`.

## Routes

- `GET /api/quality/documentation`
- `POST /api/quality/documentation`
- `GET /api/quality/documentation/default`
- `GET /api/quality/documentation/:id`
- `GET /api/quality/documentation/:id/sections`
- `POST /api/quality/documentation/:id/sections`
- `GET /api/quality/documentation/sections/:sectionId`
- `PATCH /api/quality/documentation/sections/:sectionId`
- `DELETE /api/quality/documentation/sections/:sectionId`
- `GET /api/quality/documentation/sections/:sectionId/versions`
- `POST /api/quality/documentation/sections/:sectionId/restore-version`
- `POST /api/quality/documentation/sections/:sectionId/merge-into/:targetSectionId`
- `GET /api/quality/documentation/missing-items`
- `POST /api/quality/documentation/missing-items`
- `PATCH /api/quality/documentation/missing-items/:id`
- `POST /api/quality/documentation/sections/:sectionId/attachments`
- `DELETE /api/quality/documentation/attachments/:id`
- `GET /api/quality/documentation/attachments/:id/download`
- `POST /api/quality/documentation/:id/preview`
- `POST /api/quality/documentation/:id/export-pdf`
- `GET /api/quality/documentation/:id/exports`

## Permissions

Permissions ajoutees :

- `quality.document.read`
- `quality.document.create`
- `quality.document.edit`
- `quality.document.delete`
- `quality.document.export`
- `quality.document.admin`

Les roles `admin` et `responsable` restent privilegies via le mecanisme existant.

## Generation PDF

Le PDF est genere cote serveur par Puppeteer. L'apercu et l'export utilisent le meme template HTML.
Le PDF inclut page de garde, historique de revisions, sommaire, informations a completer, corps documentaire, annexes listees, entetes/pieds de page CSS et pagination.

## Arborescence documentaire

L'arborescence est adaptable depuis l'interface :

- renommer un chapitre via le champ `Titre` ;
- deplacer un chapitre via le champ `Ranger dans` ;
- modifier l'ordre via le champ `Ordre` ou les boutons `Monter` / `Descendre` ;
- masquer un chapitre de l'export avec `Affiche dans le PDF` ;
- creer un nouveau chapitre depuis le bouton `Ajouter` ;
- supprimer un chapitre par archivage logique ;
- fusionner un chapitre dans un autre avec transfert du contenu, des pieces jointes et des informations a completer.

Exemple metier mareyage : le chapitre `Ventilation` peut etre renomme en `Conditions climatiques des locaux` ou fusionne dans `Atelier refrigere` sans perdre les annexes ni les points a completer.

## Stockage

Les pieces jointes sont stockees dans `backend/uploads/quality-documentation-attachments`.
Les exports PDF sont journalises et stockes dans `backend/uploads/quality-documentation-exports`.

## Initialisation

La premiere ouverture de `/api/quality/documentation/default` cree la collection par defaut et l'arborescence des 9 tomes.
Les informations ALTA MAREE connues sont pre-remplies uniquement dans les chapitres adaptes. Les points non confirmes sont crees en informations a completer.

## Migration

Commande indicative :

```bash
psql "$DATABASE_URL" -f backend/db/gestion-commerciale/20260713_quality_documentation.sql
```

Adapter la commande au mode de deploiement PostgreSQL utilise en production.

## Tests

Commandes de controle syntaxique :

```bash
node --check backend/routes/quality/documentation.js
node --check backend/services/quality/qualityDocumentationService.js
node --check backend/services/quality/qualityDocumentationExportService.js
node --check frontend/quality/js/documentation.js
```

Tests manuels recommandes apres migration :

- ouvrir la Home et verifier la carte Documentation Qualite ;
- ouvrir `/quality/pages/documentation.html` ;
- verifier les 9 tomes ;
- modifier un chapitre et verifier la version ;
- ajouter/resoudre une information a completer ;
- joindre un fichier ;
- lancer l'apercu PDF puis l'export PDF ;
- ouvrir le PDF et verifier logo, accents, sommaire et pagination ;
- tester avec un utilisateur sans permission.

## Deploiement

1. Deployer le code backend et frontend.
2. Executer la migration SQL.
3. Redemarrer l'API Node.
4. Verifier `PUPPETEER_EXECUTABLE_PATH` si Chromium n'est pas embarque sur le serveur.
5. Tester un export PDF reel.

## Limites connues

- La comparaison visuelle de versions est conservee cote donnees mais l'interface V1 ne presente pas encore un diff complet.
- Les PDF annexes sont listes dans la V1 ; leur fusion physique peut etre ajoutee ensuite.
- L'editeur riche utilise `contenteditable` pour eviter une dependance lourde.
- L'identite avancee non presente dans `store_settings` reste nulle tant que les colonnes metier correspondantes n'existent pas.
