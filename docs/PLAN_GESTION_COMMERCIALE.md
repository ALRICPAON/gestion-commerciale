# Plan Gestion Commerciale

## Objectif

Gestion Commerciale devient un outil de negoce et de pilotage commercial, separe de Rayon V2. Le socle doit permettre de gerer les clients, articles/produits, stocks, devis, commandes, bons de livraison, factures, tableau de bord et assistant IA.

Le nettoyage actuel conserve uniquement les fondations techniques utiles : authentification, utilisateurs, roles, rattachements par service, backend Express, PostgreSQL et architecture multi-base.

## Architecture conservee

- Backend Express / Node.
- PostgreSQL.
- `db.js` pour les connexions simples.
- `dbRegistry.js` comme registre multi-base.
- `scorpa -> gestion_commerciale`.
- `client_key` conserve comme cle de routage client.
- Middlewares `auth`, `dbContext`, `authorization`.
- Routes conservees : `auth.js` et `users.js`.
- Frontend conserve : `login`, `home`, `users`, `config.js`, `app.css`.
- PM2 conserve pour `gestion-commerciale-api`.

Rayon V2 reste totalement separe : aucun scan, aucune route et aucun fichier metier Rayon V2 ne doit etre utilise par Gestion Commerciale.

## Roles conserves

- `admin`
- `responsable`
- `commercial`
- `qualite`
- `vendeur`

## Regle de tracabilite utilisateur connecte

Toute future action metier devra etre rattachee a l'utilisateur connecte via le JWT et le contexte DB :

- `user_id`
- `store_id`
- `client_key`
- date/heure de l'action
- type d'entite concernee
- details utiles en JSON si necessaire

La table `user_audit_events` du schema core prepare cette tracabilite sans imposer encore la logique metier finale.

## Modules futurs

- Clients
- Articles / Produits
- Stocks
- Devis
- Commandes
- Bons de livraison
- Factures
- Tableau de bord
- Assistant IA

## Priorites

1. Clients
2. Articles / Produits
3. Devis et commandes
4. Bons de livraison et factures
5. Stocks et tableau de bord
6. Assistant IA

Le prochain module prioritaire est `Clients`, puis `Articles / Produits`.
