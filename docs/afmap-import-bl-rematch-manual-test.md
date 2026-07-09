# Test manuel - rematch AF_MAP pendant import BL

Objectif: verifier que les mappings AF_MAP crees pendant le flux d'import BL sont reutilises immediatement, sans supprimer puis reimporter le BL.

## Scenario principal

1. Choisir un BL fournisseur contenant au moins une reference fournisseur absente de `supplier_article_mappings`.
2. Importer le BL depuis l'ecran achats.
3. Dans le modal de mapping, associer chaque reference inconnue a un article Gestion Commerciale.
4. Enregistrer les mappings.
5. Verifier que la fiche BL s'ouvre directement avec les lignes produits renseignees.
6. Verifier en base que les lignes importees ont un `article_id` non nul et, pour les lignes remappees, un `supplier_article_mapping_id` non nul.
7. Verifier que les lignes AF_MAP existent dans `supplier_article_mappings` avec `is_active = true`.

## Non-regression

1. Supprimer uniquement le BL de test, en conservant les AF_MAP crees.
2. Reimporter exactement le meme fichier.
3. Verifier que le BL est cree avec les lignes produits directement, sans ouverture du modal de mapping.
4. Verifier qu'un BL dont tous les articles etaient deja mappes avant import continue a se creer normalement.

## Cas d'erreur attendu

Si une ligne reste sans article apres l'enregistrement des mappings, le modal doit afficher un message indiquant les references encore non mappees et ne doit pas rediriger silencieusement vers le detail du BL.
