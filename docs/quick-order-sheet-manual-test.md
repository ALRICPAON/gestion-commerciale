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
22. Cliquer sur `Vider les saisies` et verifier que seules les valeurs Colis / Kg sont effacees.
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

## Migration des anciens brouillons

1. Simuler un ancien brouillon navigateur sans `sheetId` dans `localStorage`.
2. Recharger la fiche et verifier qu'un UUID v4 valide est cree automatiquement.
3. Simuler un ancien brouillon avec un `sheetId` invalide, par exemple `col-abc`.
4. Recharger la fiche et verifier que ce `sheetId` est remplace automatiquement sans vider le reste du brouillon.
5. Verifier que l'apercu email fournisseur, l'envoi confirme et la generation de commande n'envoient jamais un `sheet_id` non UUID.

## Royale Maree et Pennylane

1. Utiliser deux magasins affilies differents dont le client facture est Royale Maree.
2. Saisir au moins deux produits sur chaque magasin affilie.
3. Generer la commande et verifier qu'une commande est portee par le client facture Royale Maree.
4. Verifier que chaque ligne conserve son magasin affilie dans `delivered_client_id` et `delivered_client_name_snapshot`.
5. Verifier dans la page Ventes que la commande Royale Maree apparait dans l'onglet `Commandes`.
6. Generer le BL puis la facture client.
7. Verifier que le detail du magasin affilie est conserve sur les lignes du BL et de la facture.
8. Synchroniser la facture vers Pennylane sur un environnement de test.
9. Verifier que le client comptable Pennylane est Royale Maree.
10. Verifier que chaque ligne envoyee a Pennylane contient le nom du magasin affilie dans le libelle, par exemple `[Magasin] - [Article]`, et la description `N colis x P kg`.

## Non-regression

1. Ouvrir les modules `Ventes / Commandes`, `BL`, `Cours / Mercuriale` et `Planning`.
2. Verifier que les pages se chargent comme avant.
3. Verifier qu'aucune commande client n'est creee en base lors de l'utilisation, de la sauvegarde locale, de l'apercu email ou de l'impression de la fiche.
4. Verifier qu'aucun e-mail n'est envoye pendant les tests automatises (`NODE_ENV=test` ou `DISABLE_OUTBOUND_EMAILS=true`).

## Cas utile

Il doit etre possible d'imprimer une fiche vierge de commandes avec une selection de clients et produits, meme si les champs `Colis` / `Kg`, le stock ou le prix doivent etre saisis manuellement.
