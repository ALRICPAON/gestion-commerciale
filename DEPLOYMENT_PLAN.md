# Déploiement Rayon V2 — Plan Production SaaS

## Architecture retenue

- Frontend statique HTML/CSS/JS
- Backend Node.js / Express
- PostgreSQL managé
- 1 base PostgreSQL par client
- Stockage fichiers/photos séparé
- Nginx en reverse proxy
- HTTPS obligatoire
- PM2 pour maintenir Node.js actif

## Environnements

- Local : développement
- Staging : test avant mise en production
- Production : vrais clients

## Sécurité obligatoire

- Aucune clé secrète dans GitHub
- Variables dans .env
- JWT_SECRET fort
- SSH par clé
- Firewall actif
- HTTPS obligatoire
- Sauvegardes automatiques
- Logs serveur

## Mises à jour

Workflow :

1. développement local
2. test staging
3. migration SQL
4. déploiement production
5. redémarrage backend

Commande cible :

git pull
npm install
npm run migrate
pm2 restart rayon-v2

## Multi-clients

Choix retenu :

- 1 base de données par client
- même code applicatif pour tous
- mise à jour centralisée
- isolation forte des données