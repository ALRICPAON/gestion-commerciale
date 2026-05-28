# Plan Gestion Commerciale

## Objectif

Gestion Commerciale devient un outil de negoce et de pilotage commercial, separe de Rayon V2. Le socle doit permettre de gerer les clients, articles/produits, stocks, devis, commandes, bons de livraison, factures, tableau de bord et assistant IA.

Le nettoyage actuel conserve uniquement les fondations techniques utiles : authentification, utilisateurs, roles, rattachements par service, backend Express, PostgreSQL et architecture multi-base.

---

# Architecture globale validee

## Stack technique

* Frontend HTML / CSS / JS statique
* Backend Node.js / Express
* PostgreSQL
* Docker
* PM2
* Nginx
* GitHub + GitHub Actions
* VPS OVH

## Architecture backend

* `db.js` pour les connexions simples
* `dbRegistry.js` comme registre multi-base
* `scorpa -> gestion_commerciale`
* `client_key` conserve comme cle de routage client
* Middlewares :

  * `auth`
  * `dbContext`
  * `authorization`
* Auth JWT
* API Express structuree par routes

## Structure frontend validee

frontend/

* css/

  * app.css
  * pages/
* js/
* login.html
* home.html
* users.html
* articles.html
* article-detail.html
* suppliers.html
* supplier-detail.html
* clients.html
* client-detail.html

Chaque module possede :

* page liste
* page detail
* JS dedie
* CSS dedie dans `frontend/css/pages/`

---

# Separation des projets

## Gestion Commerciale

Projet dedie :

* negoce
* commerce
* clients
* devis
* commandes
* facturation
* pilotage commercial
* assistant IA

Base PostgreSQL :

```txt
gestion_commerciale
```

API PM2 :

```txt
gestion-commerciale-api
```

Frontend :

```txt
https://scorpaseafood.fr
```

API :

```txt
https://api.scorpaseafood.fr
```

## Rayon V2

Projet totalement separe.

Base PostgreSQL :

```txt
gestion_rayons
```

API PM2 :

```txt
rayon-v2-api
```

Aucune logique Rayon V2 ne doit etre reutilisee directement dans Gestion Commerciale.

---

# Configuration VPS validee

## VPS OVH

IP publique IPv4 :

```txt
51.75.18.227
```

IPv6 :

```txt
2001:41d0:305:2100::fb5c
```

## Docker PostgreSQL

Conteneur PostgreSQL :

```txt
gestion-rayons-db
```

Ports exposes :

```txt
5432
```

## PM2

Applications actives :

* `gestion-commerciale-api`
* `rayon-v2-api`

Module PM2 :

* `pm2-logrotate`

---

# GitHub / Auto Deploy

## GitHub Actions

Workflow actif :

```txt
.github/workflows/deploy.yml
```

Le deploy automatique fonctionne desormais :

```txt
git push
↓
GitHub Actions
↓
SSH VPS
↓
git pull
↓
npm install
↓
pm2 restart gestion-commerciale-api
```

## Secrets GitHub configures

* `VPS_HOST`
* `VPS_USER`
* `VPS_SSH_KEY`

## Remote Git VPS

Le VPS utilise maintenant SSH GitHub :

```txt
git@github.com:ALRICPAON/gestion-commerciale.git
```

Plus besoin d'entrer le mot de passe GitHub sur le serveur.

---

# Roles conserves

* `admin`
* `responsable`
* `commercial`
* `qualite`
* `vendeur`

---

# Regle de tracabilite utilisateur connecte

Toute action metier devra etre rattachee au JWT et au contexte DB :

* `user_id`
* `store_id`
* `client_key`
* date/heure
* type d'entite
* details JSON

La table `user_audit_events` prepare cette tracabilite.

---

# Etat actuel des modules

## Authentification / Utilisateurs

Fonctionnel :

* login JWT
* middleware auth
* gestion utilisateurs
* roles
* rattachement utilisateur/client
* PM2
* PostgreSQL
* API Express

## Articles / Produits

Module valide et operationnel :

* liste articles
* detail article
* creation / modification
* API backend fonctionnelle
* CSS modulaire
* architecture frontend/backend stabilisee

## Fournisseurs

Module valide et operationnel :

* liste fournisseurs
* detail fournisseur
* creation / modification
* statuts fournisseur
* types fournisseur
* formulaire detail complet
* CSS dedie
* routes backend fonctionnelles
* integration frontend/backend OK

## Clients

Module cree et structure validee :

### Backend

* route `clients.js`
* CRUD clients
* filtres recherche/statut/type
* statuts clients
* types clients
* API `/api/clients`

### Base de donnees

Table :

```txt
clients
```

Script SQL :

```txt
backend/db/gestion-commerciale/clients.sql
```

### Frontend

Pages :

* `clients.html`
* `client-detail.html`

JS :

* `clients.js`
* `client-detail.js`

CSS :

* `frontend/css/pages/clients.css`

### Types clients

* standard
* grossiste
* gms
* restaurant
* poissonnerie
* export
* autre

### Dashboard

Le bouton Clients est maintenant actif dans `home.html`.

---

# Configuration serveur validee

## Nginx

Corrections validees :

* `try_files`
* gestion `.css`
* gestion `.js`
* frontend statique
* API reverse proxy

Frontend servi depuis :

```txt
/var/www/gestion-commerciale/frontend
```

Backend :

```txt
/var/www/gestion-commerciale/backend
```

---

# Commandes importantes

## Deploy manuel VPS

```bash
cd /var/www/gestion-commerciale

git pull origin main

cd backend
npm install

pm2 restart gestion-commerciale-api
```

## Logs PM2

```bash
pm2 logs gestion-commerciale-api --lines 80
```

## Executer un script SQL local

```powershell
Get-Content .\backend\db\gestion-commerciale\clients.sql | docker exec -i gestion-rayons-db psql -U admin -d gestion_commerciale
```

## Executer un script SQL VPS

```bash
cat backend/db/gestion-commerciale/clients.sql | docker exec -i gestion-rayons-db psql -U admin -d gestion_commerciale
```

---

# Priorites modules

Ordre actuel :

1. Clients
2. Devis
3. Commandes
4. Bons de livraison
5. Factures
6. Stocks
7. Tableau de bord
8. Assistant IA

Le prochain module prioritaire apres stabilisation Clients sera :

```txt
Devis
```

---

# Regle importante

Gestion Commerciale et Rayon V2 doivent rester totalement separes :

* bases separees
* APIs separees
* PM2 separes
* logique metier separee
* routes separees
* schemas SQL separes
* frontend separes
