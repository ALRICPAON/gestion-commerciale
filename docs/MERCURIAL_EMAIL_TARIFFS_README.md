# PR EMAIL TARIFS CLIENTS / MERCURIAL

## Objectif

Brancher l'envoi email de la mercuriale client en respectant strictement le tarif configure sur chaque client actif.

- Client `tariff_level = 1` : recoit uniquement les prix Tarif 1.
- Client `tariff_level = 2` : recoit uniquement les prix Tarif 2.
- Client `tariff_level = 3` : recoit uniquement les prix Tarif 3.

Le backend ne renvoie pas les trois grilles au frontend et ne construit pas d'email contenant plusieurs tarifs.

## Fichiers ajoutes

- `backend/services/customerTariffEmailService.js`
  - prepare la preview,
  - filtre les clients actifs,
  - ignore les clients sans email ou sans tarif valide,
  - selectionne une seule colonne de prix calculee selon le tarif client,
  - envoie via `emailService.js`,
  - trace chaque resultat par client.

- `backend/routes/customerTariffEmails.js`
  - `GET /api/customer-price-lists/email/preview`
  - `POST /api/customer-price-lists/email/send`

- `frontend/js/customer-price-list-email.js`
  - affiche la preview,
  - confirme les volumes par tarif,
  - lance l'envoi,
  - affiche le resume.

## Fichiers existants a patcher

Appliquer `patches/mercurial-email-tariffs.patch` pour :

- monter la route backend dans `backend/server.js`,
- remplacer le bouton `Email a venir` sur `frontend/customer-price-list.html`,
- charger le nouveau script frontend.

## Configuration email

Aucune migration SQL n'est necessaire.

Le module reutilise la configuration SMTP existante de `backend/services/emailService.js` :

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `MAIL_FROM_ADDRESS` ou `SMTP_FROM_EMAIL`
- `MAIL_FROM_NAME` ou `SMTP_FROM_NAME`

Le `replyTo` utilise, si disponible, les champs existants de `store_settings` :

- `email_sender_address`
- `contact_email`
- `email`

## Procedure d'application

Depuis la racine du projet :

```bash
cp -R files/backend/routes/customerTariffEmails.js backend/routes/customerTariffEmails.js
cp -R files/backend/services/customerTariffEmailService.js backend/services/customerTariffEmailService.js
cp -R files/frontend/js/customer-price-list-email.js frontend/js/customer-price-list-email.js
git apply patches/mercurial-email-tariffs.patch
```

## Verifications recommandees

```bash
node --check backend/routes/customerTariffEmails.js
node --check backend/services/customerTariffEmailService.js
node --check frontend/js/customer-price-list-email.js
```

Tests metier :

1. Client actif tarif 1 avec email : reception d'un email contenant uniquement les prix Tarif 1.
2. Client actif tarif 2 avec email : reception d'un email contenant uniquement les prix Tarif 2.
3. Client actif tarif 3 avec email : reception d'un email contenant uniquement les prix Tarif 3.
4. Client actif sans email : ignore dans le resultat.
5. Client inactif : absent de la preview et de l'envoi.
6. SMTP incomplet ou erreur SMTP : resultat en erreur sans bloquer les logs par client.
7. Verifier que le HTML et le JSON d'envoi ne contiennent jamais les autres tarifs.
