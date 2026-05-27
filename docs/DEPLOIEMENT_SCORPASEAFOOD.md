# Deploiement temporaire Scorpa Seafood

Ce projet `gestion-commerciale` est configure pour un test temporaire sous le domaine `scorpaseafood.fr`.

## Parametres cibles

- Chemin VPS du projet : `/var/www/gestion-commerciale`
- Backend : `/var/www/gestion-commerciale/backend`
- Frontend statique : `/var/www/gestion-commerciale/frontend`
- Process PM2 backend : `gestion-commerciale-api`
- Port backend dedie : `3002`
- Base PostgreSQL dediee : `gestion_commerciale`
- Domaine frontend temporaire : `https://scorpaseafood.fr`
- Domaine API temporaire : `https://api.scorpaseafood.fr`

## Separation stricte avec Rayon V2

Ne pas utiliser, modifier ou redemarrer les ressources Rayon V2 depuis ce projet :

- Projet interdit : `/var/www/rayon-v2`
- Process PM2 interdit : `rayon-v2-api`
- Base interdite : `gestion_rayons`

Les modules metier herites restent presents pour le moment, mais l'infrastructure de test doit rester separee.

## Backend

Le backend Express ecoute `process.env.PORT` avec fallback `3002`.

Exemple PM2 depuis la racine du projet :

```bash
cd /var/www/gestion-commerciale
pm2 start infra/pm2/ecosystem.config.js
pm2 restart gestion-commerciale-api
```

La variable `DB_NAME` doit pointer vers `gestion_commerciale`. Ne pas copier un `.env` Rayon V2.

## Frontend

L'URL API est centralisee dans `frontend/js/config.js`.

- Local/dev : `http://localhost:3002`
- VPS/prod temporaire : `https://api.scorpaseafood.fr`

Si l'API est servie sur le meme domaine que le frontend, remplacer temporairement `API_BASE_URL` par `https://scorpaseafood.fr` dans ce fichier.

## CORS temporaire

Les origines autorisees par defaut sont :

- `http://localhost`
- `http://localhost:3002`
- `http://localhost:8080`
- `http://127.0.0.1:3002`
- `http://127.0.0.1:8080`
- `https://scorpaseafood.fr`
- `https://www.scorpaseafood.fr`
- `https://api.scorpaseafood.fr`

Pour surcharger sans modifier le code :

```bash
CORS_ALLOWED_ORIGINS=http://localhost,http://localhost:3002,http://localhost:8080,http://127.0.0.1:3002,http://127.0.0.1:8080,https://scorpaseafood.fr,https://www.scorpaseafood.fr,https://api.scorpaseafood.fr
```

## Exemple Nginx optionnel

Cet exemple suppose un frontend sur `scorpaseafood.fr` et une API separee sur `api.scorpaseafood.fr`. A adapter au VPS reel.

```nginx
server {
    server_name scorpaseafood.fr www.scorpaseafood.fr;
    root /var/www/gestion-commerciale/frontend;
    index login.html;

    location / {
        try_files $uri $uri/ /login.html;
    }
}

server {
    server_name api.scorpaseafood.fr;

    location / {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
