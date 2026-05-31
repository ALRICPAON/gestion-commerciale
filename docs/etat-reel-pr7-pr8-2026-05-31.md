# Etat reel actuel - PR #7 et PR #8

Date de mise a jour : 2026-05-31

## Etat GitHub reel

Le depot `main` contient uniquement les evolutions fusionnees jusqu'a la PR #6 Stock.

PR fusionnees dans `main` a date :

* PR #1 : Articles en logique `store_id`.
* PR #2 : Stock / Lots.
* PR #3 : Tarifs clients sur la vue Stock.
* PR #4 : corrections Stock tarifs lots et DLC.
* PR #5 : correction source reelle `article_id` du module Stock.
* PR #6 : assouplissement validation UUID du module Stock.

## PR ouvertes non mergees

### PR #7 - Vente / Commande client

Etat : ouverte, draft, testee partiellement, non mergee.

Perimetre prepare :

* commande / vente client ;
* selection client ;
* recuperation du niveau tarifaire client ;
* proposition du tarif article HT selon Tarif 1/2/3 ;
* lignes avec colis, poids par colis, poids total, prix HT et total HT ;
* TVA selon fiche client ;
* preparation FIFO et choix manuel du lot ;
* tracabilite lot visible sur la ligne.

### PR #8 - BL / client facture / negoce

Etat : ouverte, draft, testee partiellement, non mergee.

Perimetre prepare :

* bon de livraison apres commande client ;
* client livre et client facture ;
* identifiant magasin ;
* validation BL avec destockage reel ;
* impression BL navigateur ;
* preparation etiquettes sanitaires.

## Points valides en test metier partiel

* Commande client.
* Client facture.
* Bon de livraison.
* Destockage au moment de la validation BL.

## Points a corriger avant fusion metier

* BL modifiable avant facture.
* Validation facture.
* Commande negoce : ligne OK / touche Entree.
* Export / import articles Excel.

## Migrations SQL associees aux PR non mergees

Ces migrations existent dans les PR draft mais ne sont pas considerees comme faisant partie de `main` tant que les PR #7 et #8 ne sont pas fusionnees :

```bash
cat backend/db/gestion-commerciale/035_sales_customer_order.sql | docker exec -i gestion-rayons-db psql -U admin -d gestion_commerciale
cat backend/db/gestion-commerciale/036_delivery_notes_billing_clients.sql | docker exec -i gestion-rayons-db psql -U admin -d gestion_commerciale
```

Aucune migration SQL nouvelle n'est necessaire pour cette mise a jour documentaire.
