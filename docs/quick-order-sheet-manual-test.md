# Test manuel - Fiche d'appel clients

Objectif: verifier que le module permet de preparer une fiche d'appel imprimable, de saisir les quantites Colis x Kg, de preparer l'envoi fournisseur et de generer des commandes clients uniquement apres confirmation.

## Scenario principal

1. Depuis l'accueil, ouvrir `Commerce > Fiche d'appel clients`.
2. Verifier que les clients actifs sont charges et coches par defaut.
3. Rechercher un client, decocher quelques clients, puis utiliser `Tout selectionner` et `Tout decocher`.
4. Renseigner le titre, la date et la note, par exemple `Arrivage du jour`.
5. Sur une colonne produit, ouvrir la recherche article avec le bouton de selection ou la touche `F9`.
6. Choisir un article existant.
7. Verifier que la designation est affichee, que le prix et le stock sont pre-remplis quand les donnees existent.
8. Modifier librement le prix et le stock.
9. Dupliquer une colonne produit pour representer plusieurs calibres ou variantes.
10. Verifier que l'apercu contient les clients en lignes et les produits en colonnes.
11. Dans une cellule client x produit, saisir une valeur dans `Colis`, puis utiliser `Tab` pour passer a `Kg`.
12. Saisir une valeur dans `Kg`, puis utiliser `Entree` pour passer au champ suivant.
13. Verifier que la quantite vendue de la colonne est recalculee immediatement: `Colis x Kg/colis`.
14. Verifier que l'en-tete produit affiche `Stock`, `Vendu` et `Reste`.
15. Saisir volontairement une quantite superieure au stock et verifier que l'alerte de depassement apparait a l'ecran et reste visible a l'impression.
16. Selectionner un fournisseur actif et verifier que son adresse e-mail s'affiche.
17. Cliquer sur `Apercu email fournisseur` et verifier le destinataire, l'objet et le resume des totaux par produit.
18. Verifier que le bouton `Envoyer au fournisseur` reste bloque si le fournisseur n'a pas d'adresse e-mail.
19. Cliquer sur `Envoyer au fournisseur`, annuler la confirmation, puis verifier qu'aucun e-mail n'est envoye.
20. En environnement autorise, confirmer l'envoi et verifier que l'e-mail contient le resume, la date, le titre, les notes et un PDF en piece jointe.
21. Recharger la page et verifier que les saisies, produits, titre, date, note, fournisseur et selection clients sont restaures depuis le navigateur.
22. Cliquer sur `Vider les quantites` et verifier que seules les valeurs Colis / Kg sont effacees.
23. Cliquer sur `Imprimer` et verifier que l'impression est en A4 paysage, sans zones de configuration ni boutons.
24. Verifier que les cellules imprimees affichent deux zones `Colis` et `Kg`, avec les valeurs saisies ou des cases vides pour saisie manuscrite.

## Generation des commandes

1. Preparer une fiche avec un client classique, deux produits et plusieurs lignes non vides.
2. Cliquer sur `Generer la commande`.
3. Verifier que le recapitulatif liste les lignes, les colis, le poids par colis, le total kg et le prix HT.
4. Verifier qu'un bouton clair `Confirmer et creer les commandes` apparait dans l'apercu.
5. Ne pas cliquer sur ce bouton et verifier qu'aucune commande n'est creee en base.
6. Relancer, cliquer sur `Confirmer et creer les commandes`, puis verifier que l'appel `POST /api/quick-order-sheets/generate-orders` repond `201` avec `order_ids` et `orders`.
7. Verifier en base que les commandes sont creees dans `sales_documents` avec `document_type = ORDER`, `status = draft`, `origin = quick_order_sheet`, le bon `store_id` et le bon `client_key`.
8. Verifier en base que chaque ligne contient `package_count`, `weight_per_package`, `sold_quantity` et `total_weight = package_count x weight_per_package`.
9. Verifier que le panneau affiche les references creees et un bouton `Ouvrir dans Ventes`.
10. Cliquer sur `Ouvrir dans Ventes` et verifier que les commandes apparaissent directement dans l'onglet `Commandes`, sans changer manuellement de filtre.
11. Revenir sur la fiche et recliquer sur `Generer la commande` avec le meme `sheet_id`.
12. Verifier qu'aucune commande en double n'est creee et que l'API retourne les commandes deja generees.
13. Si une ancienne generation de test existe avec le mauvais regroupement, cliquer sur `Verifier le regroupement cote serveur`.
14. Verifier que l'API retourne `409` avec `can_regenerate = true`, puis utiliser `Recreer proprement les commandes brouillon`.
15. Verifier que seules les commandes brouillon `origin = quick_order_sheet` de cette fiche sont supprimees puis recreees.

## Nouvelle fiche apres generation

1. Creer une fiche A avec au moins un client et un produit.
2. Noter la reference courte affichee dans l'interface, par exemple les 8 premiers caracteres du `sheet_id`.
3. Generer les commandes de la fiche A.
4. Cliquer sur `Vider les quantites` et verifier que le `sheet_id` affiche ne change pas.
5. Cliquer sur `Nouvelle fiche`.
6. Confirmer le message indiquant que les commandes deja generees ne seront pas supprimees.
7. Verifier que les quantites sont videes, que la date revient au jour courant, et qu'une nouvelle reference courte de fiche est affichee.
8. Verifier que les produits, clients selectionnes, fournisseur, titre et note sont conserves pour faciliter une nouvelle prise d'appel.
9. Saisir de nouvelles quantites puis generer les commandes.
10. Verifier qu'il n'y a aucun blocage d'idempotence, aucun doublon, et que les commandes de la fiche A restent intactes.

## Migration des anciens brouillons

1. Simuler un ancien brouillon navigateur sans `sheetId` dans `localStorage`.
2. Recharger la fiche et verifier qu'un UUID v4 valide est cree automatiquement.
3. Simuler un ancien brouillon avec un `sheetId` invalide, par exemple `col-abc`.
4. Recharger la fiche et verifier que ce `sheetId` est remplace automatiquement sans vider le reste du brouillon.
5. Verifier que l'apercu email fournisseur, l'envoi confirme et la generation de commande n'envoient jamais un `sheet_id` non UUID.

## Royale Maree et Pennylane

1. Utiliser deux magasins affilies differents dont le client facture est Royale Maree.
2. Saisir au moins deux produits sur chaque magasin affilie.
3. Generer la commande et verifier qu'une seule commande est creee pour Royale Maree.
4. Verifier en base que `sales_documents.client_id` et `sales_documents.billed_client_id` correspondent tous les deux a Royale Maree.
5. Verifier que chaque ligne conserve son magasin affilie dans `delivered_client_id`, `delivered_client_name_snapshot`, `delivered_client_code_snapshot` et `delivered_client_store_identifier_snapshot`.
6. Verifier dans la page Ventes que la commande Royale Maree apparait dans l'onglet `Commandes`.
7. Ouvrir la commande et controler la colonne `MAGASIN LIVRE` ligne par ligne: une ligne issue de `E.LECLERC ANCENIS` doit afficher `E.LECLERC ANCENIS`, une ligne issue de `E.LECLERC ANGERS` doit afficher `E.LECLERC ANGERS`, jamais Royale Maree par defaut.
8. Generer le BL depuis cette commande.
9. Verifier que le BL garde le client livre et le client facture a Royale Maree.
10. Verifier que le PDF BL regroupe les lignes par magasin livre, par exemple `LECLERC CHALLANS - N MAGASIN 88`, avec un sous-total par magasin.
11. Generer la facture client.
12. Verifier que le detail du magasin affilie est conserve sur les lignes de facture.
13. Synchroniser la facture vers Pennylane sur un environnement de test.
14. Verifier que le client comptable Pennylane est Royale Maree.
15. Verifier que chaque ligne envoyee a Pennylane contient le nom du magasin affilie dans le libelle, par exemple `[Magasin livre] - [Article]` ou `[Magasin livre] — [Article]`, et la description `N colis x P kg/colis`.

## Regeneration controlee Royale Maree

1. Reprendre une fiche de test deja generee avec l'ancien bug ou toutes les lignes affichaient Royale Maree en `MAGASIN LIVRE`.
2. Cliquer sur `Verifier le regroupement cote serveur` ou relancer la generation avec le meme `sheet_id`.
3. Verifier que le backend ne considere pas cette ancienne generation comme compatible si les lignes Royale Maree n'ont pas `delivered_client_id` egal au magasin source.
4. Utiliser `Recreer proprement les commandes brouillon`.
5. Verifier que seules les commandes `document_type = ORDER`, `status = draft`, `origin = quick_order_sheet` de cette fiche sont supprimees.
6. Verifier que la commande recreee est unique pour Royale Maree et que chaque ligne affiche le bon magasin livre.

## PDF fournisseur

1. Selectionner un fournisseur avec adresse e-mail.
2. Generer l'apercu email fournisseur.
3. Envoyer sur un environnement autorise ou generer le PDF fournisseur depuis le flux d'envoi.
4. Verifier que le PDF fournisseur contient uniquement fournisseur, date, produit, magasin, nombre de colis, poids par colis, poids total et notes.
5. Verifier que le PDF fournisseur ne contient jamais prix de vente, total HT, TVA, TTC ou montant commercial interne.

## Non-regression

1. Ouvrir les modules `Ventes / Commandes`, `BL`, `Cours / Mercuriale` et `Planning`.
2. Verifier que les pages se chargent comme avant.
3. Verifier qu'aucune commande client n'est creee en base lors de l'utilisation, de la sauvegarde locale, de l'apercu email ou de l'impression de la fiche.
4. Verifier qu'aucun e-mail n'est envoye pendant les tests automatises (`NODE_ENV=test` ou `DISABLE_OUTBOUND_EMAILS=true`).

## Cas utile

Il doit etre possible d'imprimer une fiche vierge de commandes avec une selection de clients et produits, meme si les champs `Colis` / `Kg`, le stock ou le prix doivent etre saisis manuellement.
