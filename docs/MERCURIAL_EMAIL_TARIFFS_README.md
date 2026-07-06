# PR Evolution Mercurial - PDF personnalise par client

## Objectif

Envoyer a chaque client actif disposant d'une adresse email une mercuriale PDF personnalisee en piece jointe.

Le niveau de prix interne du client sert uniquement au calcul cote serveur. Il n'est pas affiche dans :

- l'objet email ;
- le corps email ;
- le PDF ;
- le nom du fichier ;
- le resume frontend ;
- les logs applicatifs ;
- la reponse JSON des endpoints email.

## Fichiers inclus

- `backend/server.js`
  - version complete avec la route email Mercurial montee.
- `backend/routes/customerTariffEmails.js`
  - `GET /api/customer-price-lists/email/preview`
  - `POST /api/customer-price-lists/email/send`
  - `GET /api/customer-price-lists/email/history`
- `backend/services/customerTariffEmailService.js`
  - preview globale ;
  - generation PDF par client ;
  - envoi SMTP avec PDF en piece jointe ;
  - historique d'envoi ;
  - logs backend par client sans niveau interne.
- `frontend/customer-price-list.html`
  - version complete avec les boutons email.
- `frontend/js/customer-price-list-email.js`
  - preview, confirmation et resume d'envoi.
- `backend/db/gestion-commerciale/051_customer_price_list_email_history.sql`
  - migration idempotente pour l'historique des lots et resultats d'envoi.

## Configuration

Aucun changement des parametres email existants.

Le module reutilise `backend/services/emailService.js` et la configuration SMTP actuelle.

## Application VPS

Le ZIP est directement applicable par `rsync`.

Executer ensuite la migration SQL idempotente :

```bash
psql "$DATABASE_URL" -f backend/db/gestion-commerciale/051_customer_price_list_email_history.sql
```

Verifier les fichiers JS :

```bash
node --check backend/server.js
node --check backend/routes/customerTariffEmails.js
node --check backend/services/customerTariffEmailService.js
node --check frontend/js/customer-price-list-email.js
```

## Tests metier

1. Client actif avec email et prix internes A : recoit uniquement ses prix dans son PDF.
2. Client actif avec email et prix internes B : recoit uniquement ses prix dans son PDF.
3. Client actif avec email et prix internes C : recoit uniquement ses prix dans son PDF.
4. Client actif sans email : ignore.
5. Client inactif : absent de la preview et de l'envoi.
6. Plusieurs clients de niveaux differents : chacun recoit son propre PDF.
7. Le PDF ne contient aucune mention de niveau interne ou de grille commerciale.
