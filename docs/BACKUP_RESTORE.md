# BACKUP & RESTORE — Rayon V2

## 1. Informations importantes

### VPS

- OS : Ubuntu 24.04 LTS
- IP : `51.75.18.227`

### Backend

```text
/var/www/rayon-v2
```

### Uploads persistants

```text
/var/data/rayon-v2/uploads
```

Lien symbolique :

```text
/var/www/rayon-v2/backend/uploads -> /var/data/rayon-v2/uploads
```

### PostgreSQL Docker

Container :

```text
gestion-rayons-db
```

Base :

```text
gestion_rayons
```

Utilisateur :

```text
admin
```

### Backups

```text
/var/backups/rayonv2
```

### PM2

Nom process :

```text
rayon-v2-api
```

---

# 2. Sauvegardes automatiques actuelles

## PostgreSQL

Sauvegarde quotidienne :

```bash
docker exec gestion-rayons-db pg_dump -U admin gestion_rayons \
| gzip > /var/backups/rayonv2/rayonv2_db_$(date +%F_%H-%M).sql.gz
```

## Uploads

Sauvegarde quotidienne :

```bash
tar -czf /var/backups/rayonv2/rayonv2_uploads_$(date +%F_%H-%M).tar.gz \
/var/data/rayon-v2/uploads
```

## Rotation automatique

Les backups de plus de 7 jours sont supprimés automatiquement.

## Cron actuel

```cron
0 2 * * * /home/ubuntu/backup_rayonv2.sh >> /home/ubuntu/backup_rayonv2.log 2>&1
```

---

# 3. Restaurer PostgreSQL

## 1. Se connecter au VPS

```bash
ssh ubuntu@51.75.18.227
```

## 2. Stopper le backend

```bash
pm2 stop rayon-v2-api
```

## 3. Réinitialiser la base

```bash
docker exec -i gestion-rayons-db psql -U admin -d gestion_rayons \
-c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
```

## 4. Restaurer un backup PostgreSQL

Exemple :

```bash
gunzip -c /var/backups/rayonv2/rayonv2_db_YYYY-MM-DD_HH-MM.sql.gz \
| docker exec -i gestion-rayons-db psql -U admin -d gestion_rayons
```

## 5. Redémarrer le backend

```bash
pm2 restart rayon-v2-api
```

---

# 4. Restaurer les uploads

## 1. Supprimer les anciens uploads si nécessaire

```bash
rm -rf /var/data/rayon-v2/uploads
```

## 2. Recréer le dossier

```bash
mkdir -p /var/data/rayon-v2/uploads
```

## 3. Restaurer le backup uploads

```bash
tar -xzf /var/backups/rayonv2/rayonv2_uploads_YYYY-MM-DD_HH-MM.tar.gz -C /
```

## 4. Vérifier le lien symbolique

```bash
ls -l /var/www/rayon-v2/backend/uploads
```

Résultat attendu :

```text
/var/www/rayon-v2/backend/uploads -> /var/data/rayon-v2/uploads
```

---

# 5. Vérifications après restauration

## Vérifier PM2

```bash
pm2 status
```

## Vérifier Nginx

```bash
sudo nginx -t
```

## Vérifier l’API

```text
https://api.rayonv2.fr/db-test
```

## Vérifier le frontend

```text
https://app.rayonv2.fr
```

## Vérifications métier

- login admin OK
- stock OK
- achats OK
- photos sanitaires OK
- traçabilité OK
- inventaire OK

---

# 6. Migration future vers un nouveau serveur

Ordre recommandé :

1. Installer :
   - Docker
   - Node.js
   - PM2
   - Nginx

2. Cloner le dépôt GitHub :

```bash
git clone https://github.com/ALRICPAON/rayon-v2.git
```

3. Restaurer PostgreSQL

4. Restaurer uploads

5. Installer dépendances :

```bash
npm install
cd backend
npm install
```

6. Configurer `.env`

7. Redémarrer PM2 :

```bash
pm2 restart rayon-v2-api
```

8. Vérifier HTTPS / Nginx

---

# 7. Sécurité — recommandations

- conserver des backups hors VPS
- tester une restauration régulièrement
- protéger le fichier `.env`
- ne jamais stocker de secrets dans GitHub
- garder SSH par clé uniquement
- surveiller les logs PM2 et Nginx