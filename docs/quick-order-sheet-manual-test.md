# Test manuel - Fiche d'appel clients imprimable

Objectif: verifier que le module permet de preparer une feuille papier de prise de commandes sans creer de commande en base.

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
13. Verifier que les valeurs restent visibles dans le tableau a l'ecran.
14. Recharger la page et verifier que les saisies, produits, titre, date, note et selection clients sont restaurees depuis le navigateur.
15. Cliquer sur `Vider les saisies` et verifier que seules les valeurs Colis / Kg sont effacees.
16. Cliquer sur `Imprimer` et verifier que l'impression est en A4 paysage, sans zones de configuration ni boutons.
17. Verifier que les cellules imprimees affichent deux zones `Colis` et `Kg`, avec les valeurs saisies ou des cases vides pour saisie manuscrite.

## Non-regression

1. Ouvrir les modules `Ventes / Commandes`, `BL`, `Cours / Mercuriale` et `Planning`.
2. Verifier que les pages se chargent comme avant.
3. Verifier qu'aucune commande client n'est creee en base lors de l'utilisation, de la sauvegarde locale ou de l'impression de la fiche.

## Cas utile

Il doit etre possible d'imprimer une fiche vierge de commandes avec une selection de clients et produits, meme si les champs `Colis` / `Kg`, le stock ou le prix doivent etre saisis manuellement.
