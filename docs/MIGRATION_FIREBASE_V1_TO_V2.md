Migration Firebase V1 → Rayon V2
Objectif

Migrer les données Firebase V1 vers PostgreSQL V2 sans casser :

production Challans,
Petit Chantilly,
architecture multi-DB.
Architecture actuelle
Bases PostgreSQL VPS
gestion_rayons                 -> base TEST / DEV
gestion_rayons_challans       -> production Challans
gestion_rayons_petit_chantilly -> production Petit Chantilly
Mapping client_key

Fichier :

backend/dbRegistry.js

Mapping actuel :

default -> gestion_rayons
challans -> gestion_rayons_challans
petit_chantilly -> gestion_rayons_petit_chantilly

⚠️ IMPORTANT :

Si stores.client_key = 'challans'
dans gestion_rayons,
alors le login bascule automatiquement vers :

gestion_rayons_challans

Pour utiliser réellement la base test gestion_rayons,
le store TEST doit avoir :

client_key = 'default'

Commande :

UPDATE stores
SET client_key = 'default'
WHERE code = 'LEC001';

Puis :

pm2 restart rayon-v2-api
Export Firebase V1

Projet Firebase :

poissonnerie-gas

Fichier détecté :

js/firebase-init.js

Collections détectées :

articles
fournisseurs
AF_MAP
achats
lots
inventaires
journal
transformations
Export utilisé

Outil :

firebase-admin-sdk

Export JSON :

backup-v1.json

⚠️ NE JAMAIS PUSH :

backup-v1.json
serviceAccountKey.json

Ajouter dans :

migration-v1/.gitignore
backup-v1.json
serviceAccountKey.json
*.zip
Scripts migration

Dossier :

migration-v1/

Scripts :

01_clear_dev_data.sql
02_import_referentials.cjs
analyze-firebase-v1.cjs
Dépendances nécessaires

Installer sur local ET VPS :

npm install pg
Base cible TEST

Toujours utiliser :

gestion_rayons

Jamais directement :

gestion_rayons_challans

tant que la migration complète n’est pas validée.

Sauvegarde obligatoire avant import
docker exec gestion-rayons-db pg_dump -U admin -d gestion_rayons -f /tmp/gestion_rayons_before_firebase_import.sql

docker cp gestion-rayons-db:/tmp/gestion_rayons_before_firebase_import.sql /home/ubuntu/gestion_rayons_before_firebase_import.sql
Vidage base test
cat migration-v1/01_clear_dev_data.sql | docker exec -i gestion-rayons-db psql -U admin -d gestion_rayons
Import référentiels
node migration-v1/02_import_referentials.cjs

Résultat validé :

21 fournisseurs
996 articles
1872 supplier_article_mappings
996 article_departments
Structure V2 validée compatible
suppliers

Colonnes utilisées :

store_id
code
name
contact_name
phone
email
address

⚠️ pas de updated_at

articles

Colonnes utilisées :

designation
plu
latin_name
fao_zone
fao_subzone
fishing_gear
ean

⚠️ pas de colonne name

article_departments

Obligatoire pour affichage front.

Sans cette table :

articles invisibles dans le front.
Point critique découvert

Le front peut sembler vide alors que les données existent,
si :

client_key mauvais,
token JWT pointe autre DB,
store bascule vers Challans automatiquement.
État validé

✅ export Firebase OK
✅ import référentiels OK
✅ front serveur lit correctement base test après client_key=default
✅ architecture V2 compatible référentiels V1

Après ça :

commit,
push,
mise à jour plan/prod proprement.

---

## Mise à jour validée — Migration lots + stock + secteurs Firebase V1

### Objectif

Après migration des référentiels et des achats, migrer le stock réel Firebase V1 vers Rayon V2.

La migration stock V2 validée se fait en trois points :

1. importer les lots Firebase V1 dans `lots`
2. reconstruire `stock_summary` depuis les lots ouverts
3. restaurer les secteurs articles depuis Firebase V1 (`articles.data.rayon`) pour que le front Stock affiche correctement TRAD / LS / FE / SCE / EMB

---

## Ordre officiel des scripts de migration Firebase V1

Dossier :

```text
migration-v1/
```

Scripts à utiliser dans cet ordre :

```text
01_clear_dev_data.sql
02_import_referentials.cjs
03_import_purchases.cjs
03_import_lots.cjs
04_update_article_sectors_from_firebase.cjs
```

### `01_clear_dev_data.sql`

Vide la base cible avant réimport.

À utiliser uniquement sur base test ou lors d’une vraie migration préparée avec backup.

### `02_import_referentials.cjs`

Importe :

- fournisseurs
- articles
- AF_MAP / supplier_article_mappings
- article_departments

Résultat déjà validé :

```text
21 fournisseurs
996 articles
1872 supplier_article_mappings environ
996 article_departments
```

### `03_import_purchases.cjs`

Importe les achats Firebase V1 vers :

```text
purchases
purchase_lines
purchase_line_metadata si prévu par le script
```

À lancer après les référentiels.

### `03_import_lots.cjs`

Importe la collection Firebase V1 `lots` vers la table PostgreSQL V2 `lots`.

Champs V1 utilisés :

```text
achatId
ligneId
prixAchatKg
poidsInitial
poidsRestant
plu
designation
fournisseurRef
fao
sousZone
engin
nomLatin
createdAt
closed
```

Mapping principal :

```text
Firebase V1                    -> PostgreSQL V2 lots

plu                            -> article_id retrouvé via articles.plu
achatId                        -> purchase_id si mapping legacy disponible, sinon null
ligneId                        -> purchase_line_id si mapping legacy disponible, sinon null
fournisseurRef                 -> supplier_id si fournisseur retrouvé
prixAchatKg                    -> unit_cost_ex_vat
poidsInitial                   -> qty_initial
poidsRestant                   -> qty_remaining
closed / poidsRestant = 0      -> status closed
fao / sousZone / engin         -> traceability_data
nomLatin                       -> traceability_data.latin_name
createdAt                      -> created_at
```

Points importants :

```text
qty_initial = max(qty_initial, qty_remaining)
lot_code = V1-{PLU}-{ID_LOT_COURT}
```

Le script reconstruit ensuite automatiquement `stock_summary` depuis les lots ouverts.

### `04_update_article_sectors_from_firebase.cjs`

Restaure les secteurs articles depuis Firebase V1.

Source Firebase :

```text
articles.{PLU}.data.rayon
```

Mapping officiel :

```text
trad -> TRAD
ls   -> LS
fe   -> FE
sce  -> SCE
emb  -> EMB
```

Ce script est obligatoire après `03_import_lots.cjs`.

Sans lui :

- `stock_summary` peut contenir les bonnes lignes
- mais le front Stock reste vide ou incomplet
- car le front affiche uniquement les secteurs TRAD / FE / LS / SCE / EMB

Problème réel rencontré et corrigé :

```text
stock_summary = 237 articles
total stock = 19065.720
100% des lignes = SANS_SECTEUR
donc rien ne s’affichait correctement dans le front Stock
```

Correction validée :

```text
node migration-v1/04_update_article_sectors_from_firebase.cjs
```

---

## Commandes test validées sur VPS

Se placer dans le projet :

```bash
cd /var/www/rayon-v2
```

Variables nécessaires :

```bash
export DB_HOST=localhost
export DB_PORT=5432
export DB_USER=admin
export DB_PASSWORD='MOT_DE_PASSE_POSTGRES_DU_BACKEND_ENV'
export TARGET_DB_NAME=gestion_rayons
export STORE_CODE=LEC001
export DEPARTMENT_CODE=POIS
```

Ne jamais coller le mot de passe dans ChatGPT.

Récupérer le mot de passe si besoin :

```bash
cat backend/.env
```

---

## Migration lots test

Lancer :

```bash
node migration-v1/03_import_lots.cjs
```

Résultat test validé :

```text
Lots Firebase : 8239
Insérés : 8231
Mis à jour : 0
Ignorés sans article : 8
Ignorés quantité invalide : 0
Erreurs : 0
```

Contrôle SQL :

```bash
docker exec -it gestion-rayons-db psql -U admin -d gestion_rayons
```

Puis :

```sql
SELECT COUNT(*) FROM lots;

SELECT COUNT(*) FROM lots
WHERE qty_remaining > 0;

SELECT COUNT(*) FROM stock_summary;

SELECT SUM(qty_remaining) AS total_lots_restants
FROM lots
WHERE qty_remaining > 0;

SELECT SUM(stock_quantity) AS total_stock_summary
FROM stock_summary;
```

Résultat test validé sur VPS :

```text
lots : 8232
lots ouverts : 453
stock_summary : 237
total_lots_restants : 19065.720
total_stock_summary : 19065.720
```

Important :

La différence de +1 lot / +5 kg par rapport au local venait probablement d’un lot déjà présent dans la base test avant réimport.

Pour une vraie migration propre, utiliser une base vidée ou propre après backup.

---

## Contrôle stock_summary par rayon

```sql
SELECT 
  ss.department_id,
  d.code,
  d.name,
  COUNT(*) AS nb_lignes,
  SUM(ss.stock_quantity) AS total_stock
FROM stock_summary ss
JOIN departments d ON d.id = ss.department_id
GROUP BY ss.department_id, d.code, d.name;
```

Résultat attendu :

```text
POIS / Poissonnerie
237 lignes
total_stock environ 19065.720
```

---

## Contrôle affichage stock / secteurs

Avant correction secteurs :

```sql
SELECT
  COALESCE(ds.code, 'SANS_SECTEUR') AS sector_code,
  COUNT(*) AS nb_articles,
  SUM(ss.stock_quantity) AS total_stock
FROM stock_summary ss
JOIN article_departments ad
  ON ad.article_id = ss.article_id
 AND ad.department_id = ss.department_id
LEFT JOIN department_sectors ds
  ON ds.id = ad.department_sector_id
JOIN articles a
  ON a.id = ss.article_id
GROUP BY COALESCE(ds.code, 'SANS_SECTEUR')
ORDER BY sector_code;
```

Si tout ressort en `SANS_SECTEUR`, lancer :

```bash
node migration-v1/04_update_article_sectors_from_firebase.cjs
```

Puis refaire le contrôle.

Résultat attendu :

```text
TRAD
LS
FE
SCE
EMB
```

avec les articles répartis selon Firebase V1 :

```text
articles.data.rayon
```

---

## Contrôle front après migration lots + secteurs

Dans le front :

```text
https://app.rayonv2.fr
```

Contrôles :

1. se connecter avec le compte du client / base test
2. vérifier rayon actif : Poissonnerie
3. ouvrir le module Stock
4. vérifier affichage des secteurs :
   - TRAD
   - FE
   - LS
   - SCE
   - EMB
5. chercher quelques articles depuis SQL dans le front

Requête SQL utile :

```sql
SELECT 
  a.plu,
  a.designation,
  ss.stock_quantity,
  ss.pma,
  ss.stock_value_ex_vat
FROM stock_summary ss
JOIN articles a ON a.id = ss.article_id
ORDER BY ss.stock_quantity DESC
LIMIT 20;
```

---

## Migration réelle Challans — procédure exacte

Uniquement après validation complète sur `gestion_rayons`.

### 1. Sauvegarde obligatoire Challans

```bash
docker exec gestion-rayons-db pg_dump -U admin -d gestion_rayons_challans -f /tmp/challans_before_firebase_migration.sql
docker cp gestion-rayons-db:/tmp/challans_before_firebase_migration.sql /home/ubuntu/challans_before_firebase_migration.sql
```

### 2. Variables pour Challans

```bash
cd /var/www/rayon-v2

export DB_HOST=localhost
export DB_PORT=5432
export DB_USER=admin
export DB_PASSWORD='MOT_DE_PASSE_POSTGRES_DU_BACKEND_ENV'
export TARGET_DB_NAME=gestion_rayons_challans
export STORE_CODE=LEC001
export DEPARTMENT_CODE=POIS
```

### 3. Lancer les scripts

Si la base Challans doit être reconstruite entièrement depuis Firebase :

```bash
cat migration-v1/01_clear_dev_data.sql | docker exec -i gestion-rayons-db psql -U admin -d gestion_rayons_challans

node migration-v1/02_import_referentials.cjs
node migration-v1/03_import_purchases.cjs
node migration-v1/03_import_lots.cjs
node migration-v1/04_update_article_sectors_from_firebase.cjs
```

Si les référentiels / achats sont déjà validés et qu’on veut seulement reprendre stock/lots :

```bash
node migration-v1/03_import_lots.cjs
node migration-v1/04_update_article_sectors_from_firebase.cjs
```

### 4. Redémarrage API

```bash
pm2 restart rayon-v2-api
pm2 status
```

### 5. Contrôles finaux Challans

```bash
docker exec -it gestion-rayons-db psql -U admin -d gestion_rayons_challans
```

Puis :

```sql
SELECT COUNT(*) FROM lots;
SELECT COUNT(*) FROM lots WHERE qty_remaining > 0;
SELECT COUNT(*) FROM stock_summary;

SELECT SUM(qty_remaining) AS total_lots_restants
FROM lots
WHERE qty_remaining > 0;

SELECT SUM(stock_quantity) AS total_stock_summary
FROM stock_summary;

SELECT
  COALESCE(ds.code, 'SANS_SECTEUR') AS sector_code,
  COUNT(*) AS nb_articles,
  SUM(ss.stock_quantity) AS total_stock
FROM stock_summary ss
JOIN article_departments ad
  ON ad.article_id = ss.article_id
 AND ad.department_id = ss.department_id
LEFT JOIN department_sectors ds
  ON ds.id = ad.department_sector_id
GROUP BY COALESCE(ds.code, 'SANS_SECTEUR')
ORDER BY sector_code;
```

Validation attendue :

```text
total_lots_restants = total_stock_summary
aucune ligne importante en SANS_SECTEUR
stock visible dans le front
```

---

## Points importants à retenir pour dimanche

- Toujours tester d’abord sur `gestion_rayons`.
- Ne jamais importer directement dans `gestion_rayons_challans` sans backup.
- `backup-v1.json`, `backup-v1.zip` et `serviceAccountKey.json` ne doivent jamais être push.
- `03_import_lots.cjs` reconstruit `stock_summary`.
- `04_update_article_sectors_from_firebase.cjs` est obligatoire pour que le stock s’affiche correctement par secteur.
- Les lots migrés ne sont pas toujours rattachés aux achats si `purchases` / `purchase_lines` ne contiennent pas de colonne legacy Firebase.
- Ce n’est pas bloquant pour le stock, car le stock dépend de `lots.article_id`, `qty_remaining` et `stock_summary`.
- Pour la traçabilité achat → lot, il faudra plus tard améliorer le mapping legacy `achatId` / `ligneId` si besoin.

---

## Mise à jour finale avant migration réelle Challans — 2026-05-22

### État validé sur base test `gestion_rayons`

Flux métier complet testé et validé avec données réelles :

- achat réel OK
- upload photo sanitaire OK
- traçabilité OK
- stock OK
- inventaire OK
- génération BL vente OK
- validation BL vente OK
- annulation validation BL vente OK avec restauration des lots
- recettes Firebase importées OK
- plateaux Firebase importés OK
- comptabilité historique importée OK
- factures fournisseurs importées OK
- lettrage factures / achats importé OK
- performances OK malgré les données réelles

### Ordre final officiel des scripts de migration

À utiliser dans cet ordre strict :

```text
01_clear_dev_data.sql
02_import_referentials.cjs
03_import_purchases.cjs
03_import_lots.cjs
04_update_article_sectors_from_firebase.cjs
05_import_recipes_plateaux.cjs
06_import_compta_history.cjs
07_import_supplier_invoices.cjs
```

### Scripts ajoutés et validés

#### `05_import_recipes_plateaux.cjs`

Importe depuis Firebase V1 :

- recettes
- plateaux
- ingrédients dans `recipe_ingredients`

Important :

- ne touche pas au stock
- ne crée pas de lots
- ne rejoue pas les fabrications historiques

#### `06_import_compta_history.cjs`

Importe l'historique comptable Firebase V1 vers :

```text
compta_daily_closures
```

Mapping Firebase récent validé :

```text
caReel             -> ca_real_ht
caN1HT             -> ca_n1_ht
caTheorique        -> theoretical_ca_ht
achatsPeriode      -> purchases_ht
achatsConsoFinal   -> real_consumed_cost_ht
marge              -> real_margin_ht
margePct           -> real_margin_pct
stockDebut         -> stock_start_value_ht
stockFinManual     -> stock_end_value_ht prioritaire
stockFin           -> stock_end_value_ht fallback
validated          -> validated
validatedAt        -> validated_at
zNote / noteZ      -> notes
```

Ancien mapping encore supporté par sécurité :

```text
achatsPeriodeHT
achatsConsoHT
venteTheoriqueHT
caTheo
```

#### `07_import_supplier_invoices.cjs`

Importe les factures fournisseurs Firebase V1 vers les tables V2 existantes :

```text
supplier_invoices
supplier_invoice_links
```

Collection Firebase V1 utilisée :

```text
factures
```

Structure Firebase détectée :

```text
factures/{fournisseurCode}__{numeroFacture}
```

Champs Firebase principaux :

```text
date
numero
fournisseurCode
montantFactureHT
montantFournisseurHT
totalPointeHT
ecartHT
ecartNote
statut
achatsPointes[]
createdAt
userId
```

Champs `achatsPointes[]` :

```text
achatId
numeroAchat
totalHT
mode
```

Mapping vers `supplier_invoices` :

```text
fournisseurCode       -> supplier_id via suppliers.code
date                  -> invoice_date
numero                -> invoice_number
montantFactureHT      -> amount_ht
totalPointeHT         -> validated_amount_ht
ecartHT               -> gap_ht
statut                -> status
ecartNote             -> notes
createdAt             -> created_at
```

Mapping vers `supplier_invoice_links` :

```text
achatsPointes[].achatId  -> purchases.bl_number -> purchase_id
achatsPointes[].totalHT  -> linked_amount_ht
purchase_line_id         -> NULL
```

Point critique validé :

`03_import_purchases.cjs` conserve l'ancien `achatId` Firebase dans :

```text
purchases.bl_number
purchases.notes = Import Firebase V1 achatId=...
```

Donc `07_import_supplier_invoices.cjs` peut rattacher les factures aux achats sans ajouter de colonne legacy.

Résultat test validé sur VPS / base `gestion_rayons` :

```text
Factures Firebase détectées : 426
importedInvoices: 426
importedLinks: 945
skippedInvoices: 0
missingSuppliers: 0
unmatchedPurchases: 0
errors: 0
```

### Correction compta période validée

Dans `backend/routes/compta.js`, route :

```text
/api/compta/period
```

Règle validée :

```text
stock_start_value_ht = stock début du premier jour validé de la période
stock_end_value_ht   = stock fin du dernier jour validé de la période
```

Ne jamais faire :

```text
SUM(stock_start_value_ht)
SUM(stock_end_value_ht)
```

Les autres indicateurs restent cumulés :

- CA
- achats
- coût consommé
- marge

### BL de vente validé — annulation métier ajoutée

Route ajoutée :

```text
POST /api/sales/:id/cancel-validation
```

Fonction :

- restaure les quantités dans les lots via `stock_movements`
- supprime les mouvements liés aux lignes de vente
- remet les lignes en `pending`
- repasse le BL en `draft`
- recalcule `stock_summary`

Règle importante :

Un BL validé ne doit pas être supprimé directement.

Il faut d'abord annuler sa validation, puis le modifier ou le supprimer en brouillon.

### Transformations et fabrications historiques Firebase

Décision validée :

- ne pas migrer les anciennes transformations/fabrications historiques
- les lots et le stock étant déjà migrés, rejouer ces mouvements risquerait de déduire le stock deux fois
- si besoin ponctuel de traçabilité ancienne, consulter la V1
- une fois les anciens lots consommés, cette donnée ne sera plus utile

### Photos Firebase anciennes

Décision validée :

- ne pas migrer les anciennes photos Firebase
- les nouveaux achats V2 gèrent correctement les photos sanitaires
- les anciens lots seront consommés progressivement

---

## Procédure finale migration réelle Challans — dimanche

### 1. Se placer sur le VPS

```bash
ssh ubuntu@51.75.18.227
cd /var/www/rayon-v2
```

### 2. Mettre le serveur à jour depuis GitHub

```bash
git status
git pull origin main
ls migration-v1
```

Vérifier que le script suivant existe bien :

```text
07_import_supplier_invoices.cjs
```

### 3. Sauvegarde obligatoire de Challans

```bash
docker exec gestion-rayons-db pg_dump -U admin -d gestion_rayons_challans -f /tmp/challans_before_firebase_migration.sql
docker cp gestion-rayons-db:/tmp/challans_before_firebase_migration.sql /home/ubuntu/challans_before_firebase_migration.sql
```

### 4. Charger les variables d'environnement

Ne jamais coller le mot de passe PostgreSQL dans ChatGPT.

Méthode recommandée :

```bash
export $(grep -v '^#' backend/.env | xargs)
export TARGET_DB_NAME=gestion_rayons_challans
export STORE_CODE=LEC001
export DEPARTMENT_CODE=POIS
```

### 5. Lancer la migration complète Challans

Uniquement après sauvegarde.

```bash
cat migration-v1/01_clear_dev_data.sql | docker exec -i gestion-rayons-db psql -U admin -d gestion_rayons_challans

node migration-v1/02_import_referentials.cjs
node migration-v1/03_import_purchases.cjs
node migration-v1/03_import_lots.cjs
node migration-v1/04_update_article_sectors_from_firebase.cjs
node migration-v1/05_import_recipes_plateaux.cjs
node migration-v1/06_import_compta_history.cjs
node migration-v1/07_import_supplier_invoices.cjs
```

### 6. Redémarrer l'API

```bash
pm2 restart rayon-v2-api
pm2 status
```

### 7. Contrôles SQL obligatoires après migration

```bash
docker exec -it gestion-rayons-db psql -U admin -d gestion_rayons_challans
```

#### Référentiels

```sql
SELECT COUNT(*) FROM suppliers;
SELECT COUNT(*) FROM articles;
SELECT COUNT(*) FROM supplier_article_mappings;
SELECT COUNT(*) FROM article_departments;
```

#### Achats

```sql
SELECT COUNT(*) FROM purchases;
SELECT COUNT(*) FROM purchase_lines;
```

#### Lots et stock

```sql
SELECT COUNT(*) FROM lots;
SELECT COUNT(*) FROM lots WHERE qty_remaining > 0;
SELECT COUNT(*) FROM stock_summary;

SELECT SUM(qty_remaining) AS total_lots_restants
FROM lots
WHERE qty_remaining > 0;

SELECT SUM(stock_quantity) AS total_stock_summary
FROM stock_summary;
```

Validation attendue :

```text
total_lots_restants = total_stock_summary
```

#### Secteurs stock

```sql
SELECT
  COALESCE(ds.code, 'SANS_SECTEUR') AS sector_code,
  COUNT(*) AS nb_articles,
  SUM(ss.stock_quantity) AS total_stock
FROM stock_summary ss
JOIN article_departments ad
  ON ad.article_id = ss.article_id
 AND ad.department_id = ss.department_id
LEFT JOIN department_sectors ds
  ON ds.id = ad.department_sector_id
GROUP BY COALESCE(ds.code, 'SANS_SECTEUR')
ORDER BY sector_code;
```

Validation attendue :

```text
TRAD
LS
FE
SCE
EMB
```

Aucune ligne importante ne doit rester en `SANS_SECTEUR`.

#### Recettes / plateaux

```sql
SELECT COUNT(*) FROM recipes;
SELECT COUNT(*) FROM recipe_ingredients;
```

#### Comptabilité

```sql
SELECT COUNT(*) FROM compta_daily_closures;
```

#### Factures fournisseurs / lettrage

```sql
SELECT COUNT(*) FROM supplier_invoices;
SELECT COUNT(*) FROM supplier_invoice_links;

SELECT
  status,
  COUNT(*) AS nb,
  SUM(amount_ht) AS total_factures_ht,
  SUM(validated_amount_ht) AS total_pointe_ht,
  SUM(gap_ht) AS total_ecart_ht
FROM supplier_invoices
GROUP BY status
ORDER BY status;
```

Résultat test validé sur base `gestion_rayons` :

```text
supplier_invoices      = 426
supplier_invoice_links = 945
```

### 8. Contrôles front obligatoires

Sur :

```text
https://app.rayonv2.fr
```

Contrôler :

1. connexion compte Challans OK
2. rayon actif = Poissonnerie
3. Articles visibles
4. Achats visibles
5. Stock visible par secteurs TRAD / FE / LS / SCE / EMB
6. Traçabilité OK
7. Inventaire OK
8. Ventes / BL OK
9. Comptabilité OK
10. Factures fournisseurs / lettrage OK

---

## Points importants à retenir pour dimanche

- Toujours faire la sauvegarde Challans avant toute migration réelle.
- Ne jamais importer dans `gestion_rayons_challans` sans backup.
- `backup-v1.json`, `backup-v1.zip` et `serviceAccountKey.json` ne doivent jamais être push.
- `03_import_purchases.cjs` doit être lancé avant `07_import_supplier_invoices.cjs`.
- `07_import_supplier_invoices.cjs` dépend de `purchases.bl_number` pour retrouver les anciens `achatId` Firebase.
- `03_import_lots.cjs` reconstruit `stock_summary`.
- `04_update_article_sectors_from_firebase.cjs` est obligatoire pour que le stock s'affiche correctement par secteur.
- Les transformations/fabrications historiques Firebase ne sont pas rejouées pour éviter une double déduction du stock.
- Les anciennes photos Firebase ne sont pas migrées.
- Les nouveaux achats V2 gèrent correctement les photos sanitaires.
- Après migration, vérifier le front avant d'utiliser la base en production réelle.

---

## Commandes GitHub après mise à jour de cette documentation

Depuis le PC :

```bash
git add docs/MIGRATION_FIREBASE_V1_TO_V2.md migration-v1/07_import_supplier_invoices.cjs
git commit -m "docs(migration): finalize Firebase V1 to V2 migration with supplier invoices"
git push origin main
```

Sur le VPS :

```bash
cd /var/www/rayon-v2
git pull origin main
pm2 restart rayon-v2-api
```

