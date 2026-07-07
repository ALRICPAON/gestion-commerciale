# Tests - Commission ROYALE MAREE et PDF mercuriale

## Scenario metier attendu

- Commission ROYALE MAREE parametree : 0,50 EUR / kg.
- Prix de base article pour la vue Leclerc : 10,00 EUR HT.
- Prix communique dans la mercuriale Leclerc : 10,50 EUR HT.
- Prix article et prix repris par les bons de livraison : 10,00 EUR HT, sans commission.

## Verifications realisees

- La commission est stockee dans `store_settings`, donc rattachee au magasin par `store_id`.
- La commission est appliquee uniquement dans le calcul de mercuriale pour la vue Leclerc, actuellement le niveau interne 1.
- Les autres vues de prix ne sont pas modifiees.
- Les articles ne sont pas mis a jour : la commission n'est pas ecrite dans les prix articles.
- Le PDF mercuriale regroupe les lignes par famille, avec en-tetes de famille, tableau lisible et alternance de lignes.
- Le PDF, l'email et les logs d'envoi ne mentionnent pas `Tarif 1`, `Tarif 2`, `Tarif 3`, `Niveau tarifaire` ou `tariff_level`.
- Le template de bon de livraison n'est pas modifie : il continue d'afficher les prix enregistres sur le document de vente.

## Commandes de controle

```bash
node --check backend/routes/storeSettings.js
node --check backend/routes/customerPriceLists.js
node --check backend/services/royaleMareeCommission.js
node --check backend/services/customerTariffEmailService.js
node --check backend/services/pdf/templates/customerPriceListPdfTemplate.js
node --check frontend/js/settings.js
node --check frontend/js/customer-price-list.js
node --check frontend/js/customer-price-list-print.js
```

## Application de la migration

```bash
psql "$DATABASE_URL" -f backend/db/gestion-commerciale/052_royale_maree_commission.sql
```
