# Production Checklist — Rayon V2 — Mise à jour OVH 2026-05-14

## Sécurité

- [x] HTTPS actif pour `app.rayonv2.fr`
- [x] HTTPS actif pour `api.rayonv2.fr`
- [x] HTTPS actif pour `rayonv2.fr`
- [x] HTTPS actif pour `www.rayonv2.fr`
- [x] Firewall VPS actif
- [x] SSH par clé uniquement
- [x] Mot de passe SSH désactivé
- [x] `PermitRootLogin no`
- [x] `PasswordAuthentication no`
- [x] `PubkeyAuthentication yes`
- [x] JWT_SECRET sécurisé dans `.env`
- [x] Variables `.env` sécurisées / permissions renforcées
- [x] Aucun secret stocké dans GitHub
- [x] Ancien token GitHub exposé révoqué
- [x] Uploads sanitaires sécurisés contre path traversal
- [x] Validation stricte des IDs uploads sanitaires
- [x] Sauvegardes automatiques PostgreSQL
- [x] Sauvegardes automatiques uploads/photos
- [x] PostgreSQL non exposé publiquement

## Backend

- [x] Node.js installé (`v22.22.2`)
- [x] npm installé (`10.9.7`)
- [x] PM2 installé (`7.0.1`)
- [x] Logs Node.js actifs via PM2
- [x] Redémarrage automatique PM2 configuré
- [x] Variables environnement OK
- [x] Backend lancé via PM2 : `rayon-v2-api`
- [x] Nginx installé et actif
- [x] Reverse proxy API configuré sur `api.rayonv2.fr`
- [x] API accessible en HTTPS
- [x] PM2 logrotate installé/configuré
- [x] Configuration frontend centralisée via `frontend/js/config.js`
- [x] Logs debug frontend nettoyés
- [x] Backend production stable après déploiements réels
- [~] Pagination backend à prévoir plus tard si gros volume

## PostgreSQL

- [x] PostgreSQL Docker installé (`postgres:16`)
- [x] Conteneur Docker créé : `gestion-rayons-db`
- [x] Volume Docker persistant : `gestion_rayons_pgdata`
- [x] Base locale importée sur le VPS
- [x] Données métier Rayon V2 importées en production
- [x] Compte admin production fonctionnel
- [x] Login production validé
- [x] Sauvegarde quotidienne PostgreSQL (`pg_dump + gzip`)
- [x] Rotation automatique sauvegardes 7 jours
- [x] Premiers index SQL PostgreSQL ajoutés
- [~] Audit performance SQL avancé à prévoir plus tard
- [x] Bases dédiées clients créées : `gestion_rayons_challans`, `gestion_rayons_petit_chantilly`
- [x] Schéma PostgreSQL copié dans les bases clients
- [x] Registre multi-DB préparé côté backend (`dbRegistry.js`)
- [x] Colonne `stores.client_key` ajoutée
- [~] Bascule backend multi-DB à brancher progressivement

## Frontend

- [x] Domaine `app.rayonv2.fr` configuré
- [x] Domaine `rayonv2.fr` configuré
- [x] Domaine `www.rayonv2.fr` configuré
- [x] Frontend servi par Nginx
- [x] Page login accessible en HTTPS
- [x] Connexion utilisateur validée en production
- [x] URLs production corrigées partout
- [x] API frontend pointant vers `https://api.rayonv2.fr`
- [x] `config.js` centralise les URLs frontend/API
- [x] Cache JS/CSS versionné sur pages modifiées
- [x] Multi-photos sanitaires fonctionnelles
- [x] Galerie photos sanitaires opérationnelle
- [x] Zoom photo sanitaire grand format opérationnel
- [x] CSS restructuré progressivement par page
- [x] `app.css` allégé et recentré sur le socle global
- [x] Frontend production stable
- [~] Versioning JS/CSS à systématiser sur tout le front
- [~] Harmonisation UI progressive par petits blocs

## Uploads

- [x] Uploads persistants hors code applicatif
- [x] Uploads déplacés vers `/var/data/rayon-v2/uploads`
- [x] Lien symbolique backend uploads validé
- [x] Taille limite upload configurée Nginx/backend
- [x] Sauvegarde uploads/photos active
- [x] Test upload sanitaire validé en production
- [x] Multi-upload sanitaire validé
- [x] Upload mobile HTTPS validé

## Domaine / DNS

- [x] Domaine acheté : `rayonv2.fr`
- [x] DNS `app.rayonv2.fr` OK
- [x] DNS `api.rayonv2.fr` OK
- [x] DNS `rayonv2.fr` OK
- [x] DNS `www.rayonv2.fr` OK
- [x] HTTPS actif sur tous les domaines
- [x] Certbot renouvellement automatique actif
- [ ] Redirection explicite `rayonv2.fr` -> `app.rayonv2.fr`

## Déploiement

- [x] GitHub privé
- [x] Dépôt cloné sur VPS : `/var/www/rayon-v2`
- [x] Push GitHub validé
- [x] `git pull` VPS validé
- [x] Redémarrage PM2 validé
- [x] Déploiement production testé avec succès
- [x] Token GitHub propre conservé hors ChatGPT
- [x] Branche `main`
- [ ] Branche `develop`
- [ ] Environnement staging
- [ ] Scripts migrations SQL production formalisés
- [ ] Procédure de déploiement documentée

## Sauvegardes

- [x] Dossier backups créé : `/var/backups/rayonv2`
- [x] Script backup créé : `/home/ubuntu/backup_rayonv2.sh`
- [x] Backup manuel DB + uploads testé
- [x] Cron backup quotidien actif
- [x] Rotation automatique backups 7 jours
- [x] Logs backup actifs
- [x] Sauvegarde uploads intégrée au script backup
- [ ] Procédure restauration backup documentée
- [ ] Copie distante des sauvegardes hors VPS
## État réel validé au 2026-05-13

## Multi-DB — état migration

- [x] Middleware tenant actif
- [x] dbRegistry opérationnel
- [x] Bases clients séparées
- [x] Auth multi-DB
- [x] Users multi-DB
- [x] AF_MAP multi-DB
- [x] Articles multi-DB
- [x] Stock multi-DB
- [x] Purchases multi-DB
- [x] Purchase detail multi-DB
- [x] Purchase imports multi-DB
- [x] Purchase filters/date range multi-DB
- [x] Traceability multi-DB
- [x] Inventaire multi-DB
- [x] Compta multi-DB

Validé :

- VPS OVH opérationnel
- Ubuntu 24.04 LTS
- IP serveur : `51.75.18.227`
- Node.js / Docker / PostgreSQL / PM2 / Nginx installés
- backend lancé avec PM2
- HTTPS actif pour app + api + domaine principal + www
- `https://app.rayonv2.fr` affiche la page login
- `https://rayonv2.fr` protégé en HTTPS
- `https://api.rayonv2.fr/db-test` répond correctement
- frontend corrigé pour utiliser l'API production
- vraie base locale importée sur le VPS
- login production fonctionnel
- articles / modules métiers revenus après import base réelle
- sauvegardes PostgreSQL quotidiennes configurées
- SSH par clé validé
- mot de passe SSH désactivé

Encore à traiter :

- JWT_SECRET encore temporaire à remplacer
- permissions `.env` à renforcer
- ancien token GitHub exposé à confirmer révoqué
- uploads persistants / sauvegarde photos à organiser
- limite upload Nginx/backend à configurer
- PM2 logrotate à installer
- procédure de déploiement à documenter
- staging / branche develop à prévoir plus tard



## Mise à jour validée au 2026-05-14

Validé en plus :

- login téléphone fonctionnel après correction des URLs production
- fin des appels frontend vers anciennes URLs locales (`localhost`, `192.168.1.24`)
- page photo BL mobile opérationnelle en HTTPS
- multi-photos sanitaires par ligne achat opérationnel
- colonne `purchase_line_metadata.sanitary_photo_urls` ajoutée en JSONB
- upload photo sanitaire production validé
- stockage uploads déplacé vers `/var/data/rayon-v2/uploads`
- lien symbolique validé : `/var/www/rayon-v2/backend/uploads -> /var/data/rayon-v2/uploads`
- sauvegarde uploads ajoutée au script `/home/ubuntu/backup_rayonv2.sh`
- backup manuel DB + uploads testé
- cron backup quotidien toujours actif
- `pm2-logrotate` installé et configuré
- galerie photos sanitaires ajoutée dans la fiche achat
- clic miniature -> photo principale
- clic photo principale -> zoom grand format à droite de l’écran
- cache CSS/JS versionné sur les pages modifiées
- import achats Firebase V1 compatible multi-DB
- filtres achats par dates compatibles multi-DB
- récupération achats détaillés compatible multi-DB
- isolation client vérifiée sur imports achats
- audit des routes restantes utilisant encore `pool` effectué
- migration progressive confirmée stable en production
- aucune fuite de données détectée entre clients
- middleware tenant renforcé
- fallback sécurisé sur base par défaut contrôlé

Commandes / chemins validés :

```text
/var/data/rayon-v2/uploads
/var/www/rayon-v2/backend/uploads -> /var/data/rayon-v2/uploads
/var/backups/rayonv2
/home/ubuntu/backup_rayonv2.sh
```

Reste à traiter :

- test restauration backup à documenter
- copie distante des sauvegardes hors VPS
- cache JS/CSS à systématiser sur tout le front
- harmonisation UI progressive par petits blocs
- audit performance/index SQL plus tard si gros volume de lots

## Prochaine session — ordre exact recommandé

1. Documenter la procédure de restauration backup DB + uploads.
2. Prévoir une copie distante des sauvegardes hors VPS.
3. Systématiser le versioning JS/CSS sur tout le front.
4. Continuer l’homogénéisation UI par petits blocs si nécessaire.
5. Surveiller performance stock / traçabilité avec beaucoup de lots.
6. Prévoir plus tard pagination / filtres backend si volume important.


---

## Mise à jour validée au 2026-05-15

Validé en plus :

- sécurité upload photo sanitaire renforcée contre path traversal
- validation stricte des IDs de ligne pour uploads sanitaires
- contrôle `path.resolve` / `path.relative` pour empêcher une sortie du dossier uploads
- upload photo sanitaire toujours fonctionnel après correctif
- multi-photos sanitaires toujours fonctionnel après correctif
- fichier `frontend/js/config.js` créé
- URLs frontend centralisées :
  - `API_BASE_URL = https://api.rayonv2.fr`
  - `FRONT_BASE_URL = https://app.rayonv2.fr`
- anciennes constantes API/front supprimées des JS concernés
- tous les HTML concernés chargent `config.js` avant leur JS de page
- pages principales testées et fonctionnelles après centralisation
- logs debug frontend supprimés
- `console.error` conservés
- HTML léger nettoyé :
  - `compta-home.html`
  - `compta-suppliers.html`
  - `compta-daily.html`
  - `purchase-detail.html`
- bouton dupliqué compta supprimé
- balises HTML orphelines corrigées
- séparation CSS page par page effectuée
- `app.css` allégé et recentré sur le socle global
- CSS page ajoutés / complétés dans `frontend/css/pages/`
- pages CSS liées dans les HTML concernés
- push GitHub effectué
- `git pull` VPS effectué
- redémarrage PM2 effectué
- production testée OK après déploiement

Nouveaux fichiers / fichiers structurants validés :

```text
frontend/js/config.js
frontend/css/pages/af-map.css
frontend/css/pages/article-detail.css
frontend/css/pages/articles.css
frontend/css/pages/purchase-detail.css
frontend/css/pages/sale-detail.css
frontend/css/pages/users.css
```

Etat réel après cette mise à jour :

- frontend production stable
- backend production stable
- upload sanitaire sécurisé
- config frontend plus propre
- CSS global plus maintenable
- production OVH toujours opérationnelle

## Prochaine session — ordre recommandé mis à jour

1. Continuer éventuellement l’homogénéisation UI par petits blocs.
2. Ajouter `btn-success` et `btn-muted` dans `app.css` si besoin global.
3. Harmoniser les cartes / tableaux compta progressivement.
4. Ne pas lancer de refonte UI massive.
5. Surveiller performance stock / traçabilité quand le nombre de lots augmente.
6. Prévoir plus tard pagination / filtres backend si volume important.
7. Documenter restauration backup DB + uploads.
8. Prévoir copie distante des sauvegardes hors VPS.
9. Systématiser le versioning JS/CSS sur tout le front.

---

## Mise à jour validée au 2026-05-16 — Multi-DB Clients

Validé en plus :

- architecture multi-base PostgreSQL opérationnelle
- séparation réelle des données par client
- bases clients actives :
  - `gestion_rayons_challans`
  - `gestion_rayons_petit_chantilly`
- registre multi-DB backend fonctionnel
- sélection automatique de la DB selon `client_key`
- middleware multi-tenant branché
- login multi-DB fonctionnel
- JWT compatibles multi-DB
- utilisateurs totalement isolés par client
- rayons isolés par client
- CRUD utilisateurs compatible multi-DB
- création utilisateur compatible multi-DB
- désactivation utilisateur compatible multi-DB
- récupération des rayons par client fonctionnelle
- système de permissions conservé
- conservation architecture 1 DB = 1 client
- aucune mutualisation de données métier entre clients
- migration progressive route par route validée
- production stable après migration Users/Auth
- déploiement VPS validé après migration multi-DB

Validé côté métier :

- Petit Chantilly et Challans totalement séparés
- aucun utilisateur ne voit les données d’un autre magasin
- chaque client garde ses propres rayons
- architecture prête pour futurs magasins

A prévoir ensuite :

- audit final complet des routes backend restantes
- suppression progressive des derniers imports `pool`
- monitoring performance multi-DB long terme
- automatisation future création client + DB
- supervision PostgreSQL multi-tenant
- optimisation index SQL gros volumes
- sécurisation middleware rôles/permissions globale
- audit final des routes restantes utilisant encore `pool`

Etat réel :

- socle SaaS multi-magasin désormais validé
- architecture scalable propre
- base technique V2 considérée stable

---

## Mise à jour validée au 2026-05-16 — Initialisation rayons clients

Validé en plus :

- script SQL d’initialisation des rayons clients créé
- fichier :
  - `backend/db/027_init_client_departments.sql`
- script compatible multi-DB
- script idempotent via :
  - `ON CONFLICT (store_id, code) DO UPDATE`
- protection contre exécution sur la mauvaise base (`gestion_rayons`)
- conservation des IDs rayons existants
- compatibilité conservée avec `user_departments`
- rayons standards ajoutés automatiquement aux nouveaux clients
- rayons manquants ajoutés sur Petit Chantilly
- conservation des rayons déjà existants
- aucun écrasement des données métier
- rayon principal conservé comme rayon spécial global
- séparation métier des rayons validée par client

Rayons standardisés :

- Poissonnerie
- Boucherie
- Charcuterie
- Traiteur
- Boulangerie
- Pâtisserie
- Fruits et légumes
- Fromage
- Épicerie
- Surgelés
- DPH
- Liquides

Etat réel :

- Challans opérationnel
- Petit Chantilly opérationnel
- structure prête pour nouveaux magasins
- onboarding futur client simplifié
- architecture multi-rayons stabilisée

A prévoir ensuite :

- finaliser migration des modules métier restants vers multi-DB
- sécurisation globale middleware permissions
- préparation future création automatique de magasin/rayons