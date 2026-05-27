# Deploiement temporaire Gestion Commerciale

Ce plan concerne uniquement le projet `gestion-commerciale` pour le test sous `scorpaseafood.fr`.

## Architecture retenue

- Frontend statique HTML/CSS/JS dans `frontend`
- Backend Node.js / Express dans `backend`
- Backend expose sur le port `3002`
- Process PM2 : `gestion-commerciale-api`
- Base PostgreSQL dediee : `gestion_commerciale`
- Frontend temporaire : `https://scorpaseafood.fr`
- API temporaire : `https://api.scorpaseafood.fr`

## Separation obligatoire

Ne pas utiliser ni modifier les ressources Rayon V2 :

- `/var/www/rayon-v2`
- `rayon-v2-api`
- `gestion_rayons`

## Deploiement

Depuis `/var/www/gestion-commerciale` :

```bash
git pull
npm install
cd backend && npm install
cd ..
pm2 start infra/pm2/ecosystem.config.js
pm2 restart gestion-commerciale-api
```

La configuration detaillee et un exemple Nginx optionnel sont dans `docs/DEPLOIEMENT_SCORPASEAFOOD.md`.
