# Fournitures & materiels

## Objectif

Le module `Fournitures & materiels` devient le referentiel central des consommables, emballages, EPI, produits d'entretien et petits materiels non commerciaux d'ALTA MAREE.

Il ne remplace pas:

- les articles commerciaux vendus;
- le stock/lots produits;
- les achats fournisseurs existants;
- le referentiel des gros equipements Qualite.

## Architecture

Migration: `backend/db/gestion-commerciale/101_supplies_materials.sql`.

Tables creees:

- `supplies_materials`: fiche principale store-level;
- `supply_material_links`: liaisons vers zones, equipements, plans de nettoyage, taches, chapitres documentaires et chapitres PMS;
- `supply_material_supplier_history`: historique simple fournisseur/reference/prix;
- ajout nullable `quality_cleaning_plans.supply_material_id`.

Le champ `metadata jsonb` porte les caracteristiques specifiques par famille, sans creer une table principale pleine de colonnes NULL.

## Documents

Aucun systeme documentaire parallele n'est cree.

Les documents physiques et metadonnees restent dans:

- `quality_master_documents`;
- `quality_document_references`.

Une fourniture est reliee aux documents maitres avec:

- `target_type = 'supply_material'`;
- `target_id = supplies_materials.id`;
- `relation_type`: `technical_sheet`, `safety_data_sheet`, `food_contact_declaration`, `certificate`, `manufacturer_notice`, `attestation`, `supplier_document`, `other`.

## Nettoyage / PMS

Les plans de nettoyage conservent `product_name` pour compatibilite.

Le nouveau champ `supply_material_id` est nullable. Quand il est renseigne, il devient la reference prioritaire. Sinon, l'ancien texte libre continue de fonctionner.

Aucune donnee de production n'est migree automatiquement.

## Permissions

- `supplies_materials.read`
- `supplies_materials.write`
- `supplies_materials.archive`
- `supplies_materials.documents`

Les roles `admin` et `responsable` restent privilegies via le systeme Qualite existant.

## Routes

- `GET /api/quality/supplies-materials`
- `GET /api/quality/supplies-materials/:id`
- `POST /api/quality/supplies-materials`
- `PATCH /api/quality/supplies-materials/:id`
- `DELETE /api/quality/supplies-materials/:id`
- `GET /api/quality/supplies-materials/:id/documents`
- `POST /api/quality/supplies-materials/:id/documents`
- `GET /api/quality/supplies-materials/:id/links`
- `POST /api/quality/supplies-materials/:id/links`
- `DELETE /api/quality/supplies-materials/links/:linkId`
- `GET /api/quality/supplies-materials/diagnostics`

## MCP

Outils publics ajoutes:

- `list_supplies_materials`
- `get_supply_material`
- `search_supplies_materials`
- `list_supply_material_documents`
- `list_supply_material_links`
- `create_supply_material`
- `update_supply_material`
- `archive_supply_material`
- `add_supply_material_document_reference`
- `add_supply_material_link`
- `archive_supply_material_link`
- `diagnose_supplies_materials`

Les ecritures utilisent le service metier `backend/services/quality/suppliesMaterials.js`.

`archive_supply_material` reste une action engageante avec confirmation humaine.

## Diagnostic Lecture Seule

Le diagnostic detecte:

- produits actifs sans fournisseur;
- produits d'entretien sans fiche technique;
- produits d'entretien sans FDS;
- emballages contact alimentaire sans declaration de conformite;
- objets sans categorie;
- references documentaires cassees;
- doublons probables;
- plans de nettoyage utilisant encore un produit texte non lie.

## Import Futur

Import Excel volontairement hors perimetre V1.

Schema attendu futur:

- identification: `code`, `name`, `category`, `subcategory`;
- fournisseur: `supplier_code` ou `supplier_id`, `supplier_reference`, `order_url`;
- achat/stock: `unit`, `packaging`, `purchase_price`, `minimum_stock`, `current_stock`;
- caracteristiques: colonnes familiales mappees vers `metadata`;
- documents: references vers documents maitres existants, sans upload automatique aveugle.

## Rollback

La migration contient un rollback manuel commente:

1. retirer la contrainte FK `quality_cleaning_plans_supply_material_fk`;
2. retirer la colonne nullable `quality_cleaning_plans.supply_material_id`;
3. supprimer les tables `supply_material_supplier_history`, `supply_material_links`, `supplies_materials`;
4. supprimer la fonction trigger `set_supplies_materials_updated_at`.

Ces commandes ne doivent etre executees qu'apres verification humaine, car elles supprimeraient le referentiel V1.
