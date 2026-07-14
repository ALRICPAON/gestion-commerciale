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
- `quality_document_diagrams`

Toutes les tables portent `store_id` et les requetes filtrent par le magasin connecte.

## Services

- `qualityDocumentationTemplateService` initialise les 9 tomes et les chapitres par defaut.
- `qualityDocumentationService` gere collections, sections, informations manquantes et tableau de bord.
- `qualityDocumentationVersionService` historise les modifications et restaure une version.
- `qualityDocumentationExportService` rend le HTML qualite et genere le PDF cote serveur.
- `companyIdentityService` lit l'identite entreprise depuis `store_settings`.
- `qualityDocumentationDiagramService` valide les diagrammes JSON, genere le rendu SVG et fournit les modeles metier.

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
- `GET /api/quality/documentation/sections/:sectionId/diagrams`
- `POST /api/quality/documentation/sections/:sectionId/diagrams`
- `GET /api/quality/documentation/diagrams/templates`
- `PUT /api/quality/documentation/diagrams/:diagramId`
- `DELETE /api/quality/documentation/diagrams/:diagramId`
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
Les couleurs appliquees dans l'editeur sont conservees dans le HTML du chapitre et restituees dans le PDF.
Les diagrammes sont rendus en SVG inline par ALTA et proteges contre les coupures avec `break-inside: avoid` / `page-break-inside: avoid`.

## Diagrammes

Les diagrammes sont stockes dans `quality_document_diagrams` sous forme JSON controlee et versionnee (`schema_version = 1`).
Le contenu riche du chapitre contient un bloc `<figure>` non editable avec un SVG snapshot. Ce snapshot est conserve dans `quality_documentation_versions.content_html`, ce qui permet a une ancienne version de conserver l'ancien rendu du diagramme.

Limites de validation :

- 100 noeuds maximum ;
- 200 liaisons maximum ;
- types de noeuds limites a `start`, `end`, `process`, `decision`, `control`, `storage`, `transport`, `document`, `non_conformity`, `external`, `note` ;
- liaisons uniquement entre noeuds existants ;
- identifiants de noeuds uniques ;
- libelles et descriptions nettoyes, sans HTML libre.

Modeles disponibles :

- diagramme vide ;
- processus simple ;
- fabrication produits de la peche ;
- decision / non-conformite ;
- retrait / rappel.

Un premier diagramme est initialise dans `T3-C18 - Diagrammes de fabrication` : `Diagramme de fabrication - Produits de la peche prepares`, avec flux principal, branche de non-conformite et associations de chapitres.

## Editeur de contenu

La barre d'outils propose une palette volontairement limitee pour conserver une presentation homogene :

- noir, texte normal ;
- rouge, information a completer ;
- vert, information validee ;
- bleu, information importante ;
- orange, attention.

Deux boutons rapides couvrent les usages principaux du dossier d'agrement : `A completer` applique le rouge au texte selectionne, et `Texte normal` remet la selection en noir.

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
node --check backend/services/quality/qualityDocumentationDiagramService.js
node backend/scripts/test-quality-document-diagrams.js
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
