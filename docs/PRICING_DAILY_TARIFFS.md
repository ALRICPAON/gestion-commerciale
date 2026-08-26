# Tarification / Cours du jour

## Modele metier

Le module Tarification devient la source primaire des prix commerciaux du jour.

- `pricing_sessions` porte un brouillon ou une publication pour un magasin et une date.
- `pricing_lines` porte les articles ALTA retenus, fournisseur, prix achat, transport et cout rendu.
- `pricing_line_tariffs` porte les prix de vente par niveau tarifaire dynamique.
- `tariff_levels` remplace progressivement les champs legacy Tarif 1/2/3.
- `supplier_price_imports` et `supplier_price_import_lines` historisent les imports de cours fournisseur.
- `supplier_article_mappings` reste le referentiel de correspondance fournisseur/article et est enrichi par une cle normalisee.

## Publication

La publication est transactionnelle dans `pricingService.publishPricingSession`.

1. verrouille la session brouillon;
2. refuse les lignes sans article ALTA;
3. marque l'ancienne publication active de la meme date en `superseded`;
4. marque la session courante en `published` et `is_active_publication=true`;
5. synchronise un miroir de compatibilite dans `quick_order_sheets` / `quick_order_sheet_products`.

L'index partiel `uq_pricing_sessions_active_publication` garantit une seule publication active par magasin/date.

## Fiche d'appel

La fiche d'appel n'est plus la source primaire. Elle reste alimentee comme miroir lors de la publication afin de conserver le workflow existant de prise de commande.

Les lignes miroir conservent `pricing_session_id`, `pricing_line_id`, `tariff_prices`, `transport_cost_ht` et `cost_rendered_ht`.

## Mercuriale

`customerPriceLists.js` lit d'abord la session Tarification publiee de la date demandee. Si aucune publication n'existe, un fallback legacy lit l'ancienne fiche d'appel.

Ce fallback est volontaire pour les anciennes dates et doit disparaitre progressivement lorsque toutes les mercuriales seront issues du pricing publie.

## Commandes

`sales_lines.unit_sale_price_ht` reste le prix contractuel/comptable final.

Les colonnes suivantes expliquent l'origine du prix:

- `pricing_session_id`
- `pricing_line_id`
- `tariff_level_id`
- `source_tariff_price_ht`
- `royale_maree_commission_ht`
- `final_unit_price_ht`

Une modification ulterieure de tarification ne modifie jamais les commandes existantes.

## Royale Maree

La commission utilise uniquement `royaleMareeCommission.js` et `store_settings.royale_maree_commission_eur_per_kg`.

Le service de resolution retourne:

- tarif source;
- commission appliquee;
- prix final.

## Import fournisseur

La V1 supporte:

- texte colle;
- CSV;
- XLS/XLSX via la route REST.

Le coeur metier ne depend pas d'un input fichier frontend. Les outils agent peuvent transmettre `raw_text` ou `lines`.

## Matching fournisseur

L'ordre de matching est deterministe:

1. mapping fournisseur exact normalise;
2. designation article normalisee exacte;
3. alias par PLU/code;
4. rapprochement textuel simple;
5. non reconnu.

Aucun article ALTA n'est cree automatiquement.

## Routes REST

- `GET /api/pricing/tariff-levels`
- `GET /api/pricing/sessions`
- `GET /api/pricing/sessions/current`
- `POST /api/pricing/sessions`
- `POST /api/pricing/sessions/duplicate`
- `GET /api/pricing/sessions/:id`
- `POST /api/pricing/sessions/:id/publish`
- `GET /api/pricing/lines`
- `POST /api/pricing/lines`
- `PATCH /api/pricing/lines/:id`
- `DELETE /api/pricing/lines/:id`
- `GET /api/pricing/history/:articleId`
- `GET /api/pricing/resolve-price`
- `GET/POST /api/pricing/supplier-imports`
- `POST /api/pricing/supplier-imports/:id/apply`
- `GET/POST /api/pricing/supplier-mappings`

## Outils Agent ALTA

Lecture:

- `list_pricing_sessions`
- `get_pricing_session`
- `get_current_pricing_session`
- `list_pricing_lines`
- `search_pricing_lines`
- `get_article_pricing_history`
- `list_tariff_levels`
- `list_supplier_price_imports`
- `get_supplier_price_import`
- `list_supplier_article_mappings`

Preparation:

- `prepare_pricing_session_create`
- `prepare_pricing_session_duplicate`
- `prepare_pricing_line_add`
- `prepare_pricing_line_update`
- `prepare_pricing_line_remove`
- `prepare_supplier_price_import`
- `prepare_supplier_import_apply`
- `prepare_supplier_article_mapping_confirm`
- `prepare_pricing_session_publish`

Execution allowlistee:

- `pricing.session.create`
- `pricing.session.duplicate`
- `pricing.line.add`
- `pricing.line.update`
- `pricing.line.remove`
- `pricing.supplier_import.create`
- `pricing.supplier_import.apply`
- `pricing.supplier_mapping.upsert`
- `pricing.session.publish`
