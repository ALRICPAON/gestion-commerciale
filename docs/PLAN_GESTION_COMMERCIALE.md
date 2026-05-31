# Plan Gestion Commerciale

## Objectif

Gestion Commerciale devient un outil de negoce et de pilotage commercial, separe de Rayon V2. Le socle doit permettre de gerer les clients, articles/produits, stocks, devis, commandes, bons de livraison, factures, tableau de bord et assistant IA.

Le nettoyage actuel conserve uniquement les fondations techniques utiles : authentification, utilisateurs, roles, rattachements par service, backend Express, PostgreSQL et architecture multi-base.

---

# Architecture globale validee

## Stack technique

* Frontend HTML / CSS / JS statique
* Backend Node.js / Express
* PostgreSQL
* Docker
* PM2
* Nginx
* GitHub + GitHub Actions
* VPS OVH

## Architecture backend

* `db.js` pour les connexions simples
* `dbRegistry.js` comme registre multi-base
* `scorpa -> gestion_commerciale`
* `client_key` conserve comme cle de routage client
* Middlewares :

  * `auth`
  * `dbContext`
  * `authorization`
* Auth JWT
* API Express structuree par routes

## Structure frontend validee

frontend/

* css/

  * app.css
  * pages/
* js/
* login.html
* home.html
* users.html
* articles.html
* article-detail.html
* suppliers.html
* supplier-detail.html
* clients.html
* client-detail.html

Chaque module possede :

* page liste
* page detail
* JS dedie
* CSS dedie dans `frontend/css/pages/`

---

# Separation des projets

## Gestion Commerciale

Projet dedie :

* negoce
* commerce
* clients
* devis
* commandes
* facturation
* pilotage commercial
* assistant IA

Base PostgreSQL :

```txt
gestion_commerciale
```

API PM2 :

```txt
gestion-commerciale-api
```

Frontend :

```txt
https://scorpaseafood.fr
```

API :

```txt
https://api.scorpaseafood.fr
```

## Rayon V2

Projet totalement separe.

Base PostgreSQL :

```txt
gestion_rayons
```

API PM2 :

```txt
rayon-v2-api
```

Aucune logique Rayon V2 ne doit etre reutilisee directement dans Gestion Commerciale.

---

# Configuration VPS validee

## VPS OVH

IP publique IPv4 :

```txt
51.75.18.227
```

IPv6 :

```txt
2001:41d0:305:2100::fb5c
```

## Docker PostgreSQL

Conteneur PostgreSQL :

```txt
gestion-rayons-db
```

Ports exposes :

```txt
5432
```

## PM2

Applications actives :

* `gestion-commerciale-api`
* `rayon-v2-api`

Module PM2 :

* `pm2-logrotate`

---

# GitHub / Auto Deploy

## GitHub Actions

Workflow actif :

```txt
.github/workflows/deploy.yml
```

Le deploy automatique fonctionne desormais :

```txt
git push
↓
GitHub Actions
↓
SSH VPS
↓
git pull
↓
npm install
↓
pm2 restart gestion-commerciale-api
```

## Secrets GitHub configures

* `VPS_HOST`
* `VPS_USER`
* `VPS_SSH_KEY`

## Remote Git VPS

Le VPS utilise maintenant SSH GitHub :

```txt
git@github.com:ALRICPAON/gestion-commerciale.git
```

Plus besoin d'entrer le mot de passe GitHub sur le serveur.

---

# Roles conserves

* `admin`
* `responsable`
* `commercial`
* `qualite`
* `vendeur`

---

# Regle de tracabilite utilisateur connecte

Toute action metier devra etre rattachee au JWT et au contexte DB :

* `user_id`
* `store_id`
* `client_key`
* date/heure
* type d'entite
* details JSON

La table `user_audit_events` prepare cette tracabilite.

---

# Etat actuel des modules

## Authentification / Utilisateurs

Fonctionnel :

* login JWT
* middleware auth
* gestion utilisateurs
* roles
* rattachement utilisateur/client
* PM2
* PostgreSQL
* API Express

## Articles / Produits

Module valide et operationnel :

* liste articles
* detail article
* creation / modification
* API backend fonctionnelle
* CSS modulaire
* architecture frontend/backend stabilisee

## Fournisseurs

Module valide et operationnel :

* liste fournisseurs
* detail fournisseur
* creation / modification
* statuts fournisseur
* types fournisseur
* formulaire detail complet
* CSS dedie
* routes backend fonctionnelles
* integration frontend/backend OK

## Clients

Module cree et structure validee :

### Backend

* route `clients.js`
* CRUD clients
* filtres recherche/statut/type
* statuts clients
* types clients
* API `/api/clients`

### Base de donnees

Table :

```txt
clients
```

Script SQL :

```txt
backend/db/gestion-commerciale/clients.sql
```

### Frontend

Pages :

* `clients.html`
* `client-detail.html`

JS :

* `clients.js`
* `client-detail.js`

CSS :

* `frontend/css/pages/clients.css`

### Types clients

* standard
* grossiste
* gms
* restaurant
* poissonnerie
* export
* autre

### Dashboard

Le bouton Clients est maintenant actif dans `home.html`.

---

# Configuration serveur validee

## Nginx

Corrections validees :

* `try_files`
* gestion `.css`
* gestion `.js`
* frontend statique
* API reverse proxy

Frontend servi depuis :

```txt
/var/www/gestion-commerciale/frontend
```

Backend :

```txt
/var/www/gestion-commerciale/backend
```

---

# Commandes importantes

## Deploy manuel VPS

```bash
cd /var/www/gestion-commerciale

git pull origin main

cd backend
npm install

pm2 restart gestion-commerciale-api
```

## Logs PM2

```bash
pm2 logs gestion-commerciale-api --lines 80
```

## Executer un script SQL local

```powershell
Get-Content .\backend\db\gestion-commerciale\clients.sql | docker exec -i gestion-rayons-db psql -U admin -d gestion_commerciale
```

## Executer un script SQL VPS

```bash
cat backend/db/gestion-commerciale/clients.sql | docker exec -i gestion-rayons-db psql -U admin -d gestion_commerciale
```

---

# Priorites modules

Ordre actuel :

1. Clients
2. Devis
3. Commandes
4. Bons de livraison
5. Factures
6. Stocks
7. Tableau de bord
8. Assistant IA

Le prochain module prioritaire apres stabilisation Clients sera :

```txt
Devis
```

---

# Regle importante

Gestion Commerciale et Rayon V2 doivent rester totalement separes :

* bases separees
* APIs separees
* PM2 separes
* logique metier separee
* routes separees
* schemas SQL separes
* frontend separes

---

# Mise a jour reprise - 2026-05-29

## Etat modules Achats / Ventes / Imports BL

Les modules Achats et Ventes ont ete ajoutes dans Gestion Commerciale, en reprenant l'ergonomie et une partie de l'architecture de Rayon V2, tout en gardant les projets separes.

### Achats

Fichiers ajoutes / branches :

* `backend/routes/purchases.js`
* `frontend/purchases.html`
* `frontend/purchase-detail.html`
* `frontend/js/purchases.js`
* `frontend/js/purchase-detail.js`
* `frontend/css/pages/purchases.css`
* `frontend/css/pages/purchase-detail.css`

Fonctions en place :

* liste achats
* creation commande / BL
* detail achat
* lignes achat
* validation reception
* lots
* mouvements stock
* stock summary
* duplication / suppression selon statut
* F9 fournisseur en cours de stabilisation
* F9 article en cours de stabilisation

### Imports BL fournisseurs

Le bloc import BL fournisseur a ete conserve et importe depuis Rayon V2 :

* `backend/services/imports/`
* detection parser
* lecture `.xlsx`, `.xls`, `.csv`, `.pdf`
* parsers fournisseurs : Scapmaree, Royale Maree, Criee, Scaouest, Sogelmer, Distrimer, Lecri Maree, GC Crustaces, etc.

Important : ne pas supprimer ce bloc. Il est indispensable pour les achats.

### Ventes

Fichiers ajoutes / branches :

* `backend/routes/sales.js`
* `frontend/sales.html`
* `frontend/sale-detail.html`
* `frontend/js/sales.js`
* `frontend/js/sale-detail.js`
* `frontend/css/pages/sale-detail.css`

Fonctions en place :

* liste ventes/sorties
* creation vente
* lignes vente
* validation sortie avec consommation stock
* annulation validation
* recherche article en stock

## SQL ajoute

Scripts ajoutes/executés :

* `backend/db/gestion-commerciale/purchases_sales_stock.sql`
* `backend/db/gestion-commerciale/020_supplier_article_mappings.sql`
* `backend/db/gestion-commerciale/migrate_from_rayon_v2.sql`
* `backend/db/gestion-commerciale/030_enrich_articles_from_rayon_v2.sql`

Tables principales creees / utilisees :

* `purchases`
* `purchase_lines`
* `purchase_line_metadata`
* `lots`
* `stock_movements`
* `stock_summary`
* `sales_documents`
* `sales_lines`
* `sale_line_allocations`
* `supplier_article_mappings`

## Migration Rayon V2 vers Gestion Commerciale

Migration reference effectuee depuis la base `gestion_rayons` vers `gestion_commerciale`, sans modifier Rayon V2.

Resultats valides :

* fournisseurs migrables : 21
* articles TRAD migrables : 593
* AF_MAP TRAD migrables : 1807
* fournisseurs en cible : 22
* articles en cible : 593
* AF_MAP en cible : 1807

Regle de migration validee :

* utiliser uniquement les articles TRAD de Rayon V2
* filtrer TRAD via `article_departments -> department_sectors.code = 'TRAD'`
* ne pas reutiliser les UUID `store_id`, `department_id`, `department_sector_id` de Rayon V2
* reconstruire les mappings AF_MAP avec `supplier.code + article.plu`
* conserver `supplier_ref` en texte pour garder les zeros devant

Patch d'enrichissement articles ajoute :

* `030_enrich_articles_from_rayon_v2.sql`

Objectif du patch : enrichir les articles TRAD avec :

* nom latin
* FAO
* sous-zone
* engin
* methode / categorie
* nom affiche
* unites achat / stock / vente

## Probleme actuel a reprendre demain : module Articles

Le module Articles a encore une logique heritee Rayon V2 basee sur les services/rayons.

Symptomes actuels :

* en haut de la page Articles et de la fiche Article, un champ `Service` / `Service des articles` apparait encore ;
* l'article cree manuellement dans Gestion Commerciale apparait dans le service actif et affiche les boutons Modifier / Supprimer / Dupliquer ;
* les articles migres depuis Rayon V2 apparaissent dans `Tous les services` ;
* les articles migres affichent seulement `Voir` + `Lecture seule` ;
* apres certaines corrections, le detail article peut ne plus afficher correctement les champs.

Cause identifiee :

* `frontend/js/articles.js` utilise encore une logique du type :

```js
function canManageArticle(article) {
  if (!activeDepartment?.id) return false;
  return String(article.department_id) === String(activeDepartment.id);
}
```

* les articles migres n'ont pas de rattachement `article_departments` dans Gestion Commerciale ;
* donc ils sont consideres comme hors service et mis en lecture seule ;
* `article-detail.html` et `article-detail.js` gardent aussi un select `Service` herite de Rayon V2.

### Decision metier validee pour Gestion Commerciale

Dans Gestion Commerciale, les articles doivent etre geres au niveau :

```txt
store_id -> articles
```

et non :

```txt
store_id -> department_id -> articles
```

Le concept de service/rayon ne doit plus bloquer la consultation, modification, duplication ou suppression des articles.

### A corriger au prochain chat

Priorite absolue : nettoyer le module Articles pour supprimer la dependance bloquante au service.

Fichiers concernes :

* `frontend/articles.html`
* `frontend/article-detail.html`
* `frontend/js/articles.js`
* `frontend/js/article-detail.js`
* `backend/routes/articles.js`

Corrections a faire :

1. Supprimer ou masquer le filtre `Service des articles` dans `articles.html`.
2. Supprimer ou neutraliser le select `Service` dans `article-detail.html`.
3. Dans `articles.js`, modifier `canManageArticle()` pour ne plus bloquer les articles sans `department_id`.
4. Dans `loadArticles()`, ne plus envoyer `department_id` par defaut.
5. Dans `saveArticle()`, autoriser la modification d'un article sans `department_id`.
6. Dans `backend/routes/articles.js`, faire en sorte que `PATCH /api/articles/:id` accepte `department_id` absent et mette a jour directement la table `articles`.
7. Ne plus retourner `Rattachement article/service introuvable` pour les articles migres sans rattachement.
8. S'assurer que `GET /api/articles/:id` retourne bien les champs enrichis depuis `articles` :
   * `latin_name`
   * `fao_zone`
   * `sous_zone`
   * `fishing_gear`
   * `allergens`
   * `production_method`
   * `display_name`
   * `purchase_unit`
   * `stock_unit`
   * `sale_unit`
9. Augmenter les versions cache dans les HTML :
   * `articles.js?v=...`
   * `article-detail.js?v=...`
   * CSS si modifie.

### Etat a ne pas casser

Sont valides et a conserver :

* separation Gestion Commerciale / Rayon V2
* fournisseurs migres
* AF_MAP migre
* articles TRAD migres
* imports BL fournisseurs
* routes achats / ventes
* base `gestion_commerciale`
* API `gestion-commerciale-api`

## Commandes utiles demain

### Redemarrer API

```bash
cd /var/www/gestion-commerciale/backend
pm2 restart gestion-commerciale-api
pm2 logs gestion-commerciale-api --lines 80
```

### Verifier articles en base

```bash
docker exec -it gestion-rayons-db psql -U admin -d gestion_commerciale
```

```sql
SELECT COUNT(*) FROM articles;
SELECT COUNT(*) FROM supplier_article_mappings;
SELECT plu, designation, latin_name, fao_zone, sous_zone, fishing_gear
FROM articles
WHERE latin_name IS NOT NULL OR fao_zone IS NOT NULL
LIMIT 20;
\q
```

### Tests apres correction articles

* ouvrir `Articles`
* verifier que les 593 articles migrés sont visibles
* verifier que les boutons Modifier / Dupliquer / Desactiver apparaissent
* ouvrir `Voir` sur un article migré
* verifier que le detail affiche nom latin / FAO / engin / unites
* modifier un article migré sans erreur `department_id`
Décision métier : pas de module Devis pour l’instant

Le projet ne démarre pas par un module Devis.

Le fonctionnement commercial souhaité est :

Commande / Vente
↓
Bon de livraison
↓
Facture

Le module prioritaire à construire ensuite est donc :

Stock / Lots
Vente / Commande client
Bon de livraison
Facture
Prochaine priorité : Module Stock / Lots

Avant de finaliser le module Vente, il faut créer ou stabiliser un vrai module Stock / Lots, proche de la logique Rayon V2.

Objectifs :

consulter le stock par article
consulter les lots disponibles
afficher les quantités restantes
afficher les informations de traçabilité
gérer le FIFO par défaut
permettre ensuite à la vente de choisir manuellement un lot à consommer

Le stock doit rester basé sur :

store_id
article_id
lots
stock_movements
stock_summary

Le module Stock / Lots doit servir de base fiable au module Vente.

Module Vente cible

Le module Vente doit gérer une vente professionnelle B2B.

Workflow
Création commande / vente
↓
Ajout des lignes
↓
Choix automatique FIFO du lot
↓
Possibilité de choisir manuellement un lot
↓
Validation
↓
Génération BL
↓
Facturation
Fiche client et TVA

La fiche client devra permettre de gérer :

client assujetti ou non à la TVA
taux de TVA applicable
informations de facturation
informations de livraison

Le module Vente doit calculer :

total HT
TVA
total TTC
total poids
total colis
Ligne de vente

Chaque ligne de vente doit gérer :

article
lot consommé automatiquement en FIFO
choix manuel possible du lot
nombre de colis
poids par colis
poids total
prix HT
total HT
TVA
total TTC
informations métier récupérées depuis l’achat / lot :
nom latin
FAO
sous-zone
engin
méthode de production
allergènes
DLC si disponible
Ergonomie ligne

Fonctions souhaitées :

bouton Enregistrer
bouton Supprimer
touche Entrée = enregistrer la ligne et passer à la ligne suivante
interface rapide pour saisie commerciale
Étiquettes sanitaires

Le module Vente doit permettre de générer les étiquettes sanitaires.

Par ligne :

bouton “Générer étiquettes”
génération selon le nombre de colis

Exemple :

10 colis x 3 kg de dos de cabillaud
=
10 étiquettes sanitaires

Sur le bon complet :

bouton général “Imprimer toutes les étiquettes”
impression de toutes les étiquettes sanitaires du bon

Les étiquettes doivent reprendre les informations métier du lot consommé.

Priorités mises à jour

Ordre actuel :

Stock / Lots
Vente / Commande client
Bon de livraison
Facture
Tableau de bord commercial
Audit / traçabilité utilisateur
Assistant IA métier

---

# Mise a jour reprise - 2026-05-31 - Stock / Lots et Tarifs clients valides

## Workflow GitHub valide

Le nouveau workflow avec agent GitHub est valide :

* Alric definit le besoin metier.
* L'agent GitHub analyse le depot.
* L'agent travaille uniquement sur une branche dediee.
* Une Pull Request est ouverte vers la bonne base.
* Alric valide apres test metier.
* La fusion dans `main` declenche GitHub Actions.
* GitHub Actions deploie automatiquement sur le VPS.
* Les migrations SQL sont executees manuellement si necessaire.
* Les tests finaux se font sur `https://scorpaseafood.fr`.

Regles confirmees :

* jamais de modification directe sur `main` ;
* jamais de fusion sans validation humaine ;
* Rayon V2 peut etre consulte comme reference metier/technique, mais ne doit jamais etre modifie ;
* ChatGPT sert d'architecte/relecteur et aide au diagnostic.

## Module Stock / Lots valide

Le module Stock / Lots est maintenant operationnel et valide sur le site.

Pull Requests mergees :

* PR #2 `feature/stock-lots` : creation/stabilisation du module Stock / Lots.
* PR #3 `feature/stock-tarifs-clients` : ajout tarifs clients et niveaux tarifaires.
* PR #4 `fix/stock-tarifs-lots-dlc` : correction DLC FIFO et pre-remplissage marges.
* PR #5 `fix/stock-article-id-real-source` : correction source reelle `article_id`.
* PR #6 `fix/stock-relax-uuid-validation` : validation UUID assouplie et cache `stock.js?v=5`.

Fichiers principaux :

* `backend/routes/stock.js`
* `frontend/stock.html`
* `frontend/js/stock.js`
* `frontend/css/pages/stock.css`
* `backend/db/gestion-commerciale/033_stock_lots_hardening.sql`
* `backend/db/gestion-commerciale/034_stock_tarifs_clients.sql`

Tables / structures confirmees :

* `lots`
* `stock_movements`
* `stock_summary`
* `articles.sale_price_level_1_ht`
* `articles.sale_price_level_2_ht`
* `articles.sale_price_level_3_ht`
* `clients.tariff_level`

Fonctions validees :

* consultation du stock par article ;
* affichage PLU, designation, stock restant, PMA HT, DLC FIFO, valeur stock HT ;
* consultation des lots disponibles via bouton `Lots` ;
* affichage de la tracabilite lot : nom latin, FAO, sous-zone, engin, methode, allergenes, DLC ;
* FIFO par defaut : DLC la plus proche puis date de creation ;
* affichage de la DLC du prochain lot disponible FIFO ;
* preparation API FIFO : `GET /api/stock/articles/:articleId/fifo?quantity=...` ;
* modification des tarifs HT 1, 2 et 3 par article ;
* calcul des marges par tarif ;
* parametres de marge globale en haut de page ;
* pre-remplissage des tarifs vides selon marge cible ;
* non-ecrasement des tarifs deja renseignes manuellement ;
* enregistrement ligne par ligne ;
* enregistrement global des tarifs pre-remplis ;
* fiche client avec choix du tarif client : Tarif 1, Tarif 2 ou Tarif 3.

## Regle metier tarifs clients

Les tarifs sont portes par l'article, au niveau magasin :

* `sale_price_level_1_ht`
* `sale_price_level_2_ht`
* `sale_price_level_3_ht`

Le client possede un niveau tarifaire :

* `tariff_level = 1`
* `tariff_level = 2`
* `tariff_level = 3`

Objectif pour le module Vente :

* si client Tarif 1 -> proposer `sale_price_level_1_ht` ;
* si client Tarif 2 -> proposer `sale_price_level_2_ht` ;
* si client Tarif 3 -> proposer `sale_price_level_3_ht`.

Le prix article enregistre manuellement est prioritaire. Les marges globales servent seulement d'aide au pre-remplissage.

Formule de pre-remplissage :

```txt
prix_vente_ht = PMA / (1 - marge / 100)
```

Formule marge affichee :

```txt
marge euro = prix_vente_ht - PMA
marge % = ((prix_vente_ht - PMA) / prix_vente_ht) * 100
```

## Corrections importantes effectuees

Probleme rencontre : les boutons `Lots`, `Enregistrer` et `Enregistrer tous` renvoyaient `ID article invalide`.

Diagnostic valide :

* la base etait correcte ;
* `stock_summary.article_id` correspondait bien a `articles.id` ;
* le probleme venait de la source `article_id` renvoyee/utilisee et d'une validation UUID trop stricte cote interface/API.

Corrections finales :

* `GET /api/stock` retourne explicitement `a.id::text AS article_id` ;
* `lotsSelectSql()` retourne `l.article_id::text AS article_id` ;
* le frontend utilise uniquement `row.article_id` pour les actions ;
* les boutons utilisent `<tr data-article-id>` comme source fiable ;
* la validation UUID accepte le format PostgreSQL standard : `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` ;
* cache frontend pousse a `stock.js?v=5` ;
* apres merge, test final valide : boutons Lots, Enregistrer, Enregistrer tous OK.

## Etat actuel valide

Modules valides / operationnels :

* Authentification / utilisateurs ;
* Articles au niveau `store_id` ;
* Fournisseurs ;
* Clients ;
* Achats / import BL fournisseur conserve ;
* Reception achat avec creation lots / mouvements stock ;
* Stock / Lots ;
* Tarifs clients par article ;
* Niveau tarifaire sur fiche client.

Le module Stock / Lots est maintenant considere comme base fiable pour construire la Vente / Commande client.

## Priorite suivante

La prochaine priorite metier est :

```txt
Vente / Commande client
```

Objectif : transformer le module Vente existant en flux commercial B2B complet :

```txt
Commande / Vente
↓
Bon de livraison
↓
Facture
```

Points obligatoires pour la prochaine etape :

* selection client ;
* recuperation automatique du `tariff_level` client ;
* proposition automatique du bon tarif article HT selon Tarif 1/2/3 ;
* ligne de vente avec article, colis, poids par colis, poids total, prix HT, total HT ;
* TVA selon la fiche client ;
* allocation FIFO automatique du lot ;
* possibilite de choisir manuellement un lot ;
* recuperation tracabilite depuis le lot consomme ;
* validation sortie avec consommation effective des lots ;
* preparation Bon de Livraison ;
* preparation Facture ;
* generation/impression des etiquettes sanitaires par ligne et pour tout le bon.

## Commandes utiles apres merge/deploiement

Remettre le VPS propre sur `main` :

```bash
cd /var/www/gestion-commerciale
git fetch origin
git checkout main
git reset --hard origin/main

cd backend
npm install
pm2 restart gestion-commerciale-api
pm2 logs gestion-commerciale-api --lines 80
```

Mettre a jour le PC local :

```powershell
cd C:\Users\apaon\OneDrive\Bureau\gestion-commerciale

git checkout main
git pull origin main
git status
```

Executer une migration SQL VPS si besoin :

```bash
cat backend/db/gestion-commerciale/NOM_DU_SCRIPT.sql | docker exec -i gestion-rayons-db psql -U admin -d gestion_commerciale
```

## Tests metier stock valides

Tests finaux realises / a refaire si besoin :

* ouvrir `Stock / Lots` ;
* verifier affichage PLU / designation / stock / PMA / tarifs / marges / DLC / valeur stock ;
* cliquer `Lots` ;
* verifier la modale lots et tracabilite ;
* renseigner marges globales ;
* pre-remplir les tarifs ;
* verifier que les tarifs deja saisis ne sont pas ecrases ;
* enregistrer une ligne ;
* enregistrer tous les tarifs pre-remplis ;
* recharger la page avec `Ctrl + F5` ;
* verifier que les tarifs restent ;
* ouvrir une fiche client ;
* choisir Tarif 1 / Tarif 2 / Tarif 3 ;
* enregistrer et recharger la fiche client.
