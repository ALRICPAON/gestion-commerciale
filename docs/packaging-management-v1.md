# Module conditionnement et emballages V1

## Perimetre

Cette V1 ajoute un module dedie aux emballages pour ALTA MAREE :

- catalogue emballages consommables, consignes fournisseur et reutilisables internes ;
- stock emballage avec mouvements historises ;
- profils de conditionnement par article ;
- operations de conditionnement avec calcul de cout total, par colis et par kg ;
- validation transactionnelle qui consomme le stock emballage ;
- suivi des emballages consignes et soldes par fournisseur ;
- points d'extension achats fournisseurs pour distinguer produit, emballage consommable, consigne et frais/service.

Le module ne lance aucune migration en production, ne fusionne rien dans `main` et ne remplace pas les flux achats existants.

## Choix d'architecture

Les emballages ne sont pas stockes dans les tables stock produit (`lots`, `stock_movements`, `stock_summary`). Ces tables sont liees au poisson et imposent `article_id` ainsi que des notions de lot, DLC, FIFO et tracabilite sanitaire. Melanger les emballages avec ces flux aurait cree des faux articles et des mouvements non conformes au metier.

La migration `060_packaging_management.sql` cree donc :

- `packaging_items` : referentiel et stock courant emballage ;
- `packaging_stock_movements` : entrees, sorties de conditionnement, pertes, inventaires et corrections ;
- `article_packaging_profiles` et `article_packaging_profile_components` : recettes d'emballage par article ;
- `packaging_operations` et `packaging_operation_lines` : operations preparatoires et couts ;
- `returnable_packaging_movements` : grand livre des consignes ;
- colonnes `purchase_lines.line_business_type`, `packaging_item_id`, `is_deposit_line` pour l'integration achat future.

## Permissions V1

Le depot n'a pas encore de permission granulaire globale pour ce domaine. La V1 expose donc des codes symboliques dans `backend/services/packaging/permissions.js` et les mappe sur les roles existants :

- lecture : tout utilisateur authentifie ;
- catalogue, profils, mouvements, validation et consignes : `admin` ou `responsable`.

## Ecritures transactionnelles

Les actions sensibles utilisent une transaction :

- mouvement de stock emballage : verrouille l'emballage, cree le mouvement, met a jour le stock courant ;
- creation d'operation : calcule les lignes depuis le profil puis cree operation et lignes ;
- validation d'operation : verrouille l'operation et les emballages, bloque la double validation, controle le stock, cree les sorties et marque l'operation validee.

Les emballages consignes sont exclus du cout consommable d'une operation. Ils sont suivis dans le grand livre de consigne.

## Scenario manuel V1

1. Aller sur `Conditionnement & Emballages` depuis l'accueil.
2. Creer `CAISSE30`, categorie `Consommable`, cout HT `1.20`, seuil `10`.
3. Ajouter une entree achat de `100`.
4. Creer `BAC-CONS`, categorie `Consigne fournisseur`, valeur consigne `8`.
5. Depuis une fiche article, creer un profil rapide `Standard` avec `CAISSE30`, quantite `1` par colis.
6. Dans le module, saisir une operation pour cet article : `100 kg`, `20 colis`.
7. Previsualiser : le module doit afficher `20` caisses et un cout emballage de `24.00 EUR`.
8. Creer le brouillon puis valider : le stock `CAISSE30` doit passer de `100` a `80`.
9. Tenter une operation qui consomme plus que le stock disponible : la validation doit etre refusee.
10. Dans `Consignes`, enregistrer `10` receptions de `BAC-CONS`, puis `6` retours.
11. Le solde consigne doit afficher `4` unites et `32.00 EUR` de valeur restante si la consigne vaut `8`.

## Test local

Le script suivant verifie les calculs, les signes de mouvements et les gardes metier sans base de donnees :

```bash
node backend/scripts/test-packaging.js
```
