# Communication email Zimbra

## Objectif

Le socle Communication centralise les paramètres publics utilisés par ALTA MARÉE pour ouvrir le webmail, le calendrier et préparer les futurs envois de documents.

Le backend reste le seul endroit autorisé à lire la configuration SMTP. Aucun mot de passe SMTP ne doit être stocké en base de données, exposé au frontend ou écrit dans les logs.

## Paramètres société

La table `store_settings` porte les champs publics suivants :

- `email_sender_name`
- `email_sender_address`
- `contact_email`
- `internal_email`
- `webmail_url`
- `calendar_url`

Valeurs par défaut ALTA MARÉE :

- Nom expéditeur : `ALTA MARÉE`
- Email expéditeur : `commercial@altamaree.fr`
- Email contact : `contact@altamaree.fr`
- Email interne : `alric@altamaree.fr`
- Webmail Zimbra OVH : `https://mail.altamaree.fr`
- Calendrier Zimbra OVH : `https://mail.altamaree.fr`

## Backend email

Le service `backend/services/emailService.js` utilise Nodemailer et lit uniquement les variables d'environnement backend :

```env
SMTP_HOST=smtp.mail.ovh.net
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=commercial@altamaree.fr
SMTP_PASS=********
MAIL_FROM_NAME=ALTA MARÉE
MAIL_FROM_ADDRESS=commercial@altamaree.fr
```

Route de test admin :

```http
POST /api/communication/email/test
```

Payload :

```json
{
  "to": "adresse@test.fr",
  "subject": "Test ALTA MARÉE",
  "message": "Message de test"
}
```

La route retourne un succès avec l'identifiant de message SMTP ou une erreur claire si la configuration SMTP est incomplète.

## Préparation des futurs envois

La structure est prête pour brancher ensuite les envois de :

- bons de livraison
- factures clients
- commandes fournisseur
- relances client

Les PDF existants ne sont pas modifiés par ce socle. Les futures pièces jointes devront être ajoutées côté backend, sans exposer les secrets SMTP au navigateur.
