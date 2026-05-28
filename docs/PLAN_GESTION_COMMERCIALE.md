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

---

# Etat actuel des modules

## Modules fonctionnels

### Authentification / utilisateurs

Fonctionnel :
- login JWT
- middleware auth
- roles
- gestion utilisateurs
- rattachement utilisateur/client
- PM2
- PostgreSQL
- API Express

### Articles / Produits

Module valide et operationnel :
- liste articles
- detail article
- creation / modification
- structure inspiree de Rayon V2
- CSS modulaire via `frontend/css/pages/`
- API backend fonctionnelle
- architecture frontend/backend stabilisee

### Fournisseurs

Module valide et operationnel :
- liste fournisseurs
- detail fournisseur
- creation / modification
- statuts fournisseur
- types fournisseur
- formulaire detail complet
- CSS dedie `frontend/css/pages/suppliers.css`
- API backend fonctionnelle
- routes Express stabilisees
- integration frontend/backend OK

## Architecture frontend validee

Structure retenue :

frontend/
- css/
  - app.css
  - pages/
- js/
- login.html
- home.html
- users.html
- articles.html
- article-detail.html
- suppliers.html
- supplier-detail.html

Chaque module possede :
- sa page liste
- sa page detail
- son JS dedie
- son CSS dedie dans `css/pages/`

## Configuration serveur validee

Nginx :
- correction du fallback `try_files`
- gestion correcte des fichiers statiques `.css` `.js`
- frontend servi depuis :
  `/var/www/gestion-commerciale/frontend`

API :
- `api.scorpaseafood.fr`
- PM2 : `gestion-commerciale-api`

## Modules suivants

Priorite suivante decidee :
1. Clients
2. Devis
3. Commandes
4. Bons de livraison
5. Factures
6. Stocks
7. Tableau de bord
8. Assistant IA

## Regle importante

Gestion Commerciale reste totalement separe de Rayon V2.

Rayon V2 :
- gestion rayon/magasin

Gestion Commerciale :
- negoce
- commerce
- clients
- devis
- commandes
- facturation
- pilotage commercial
