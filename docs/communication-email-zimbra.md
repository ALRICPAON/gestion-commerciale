# Communication email Zimbra

## Objectif

Le socle Communication centralise les paramètres publics utilisés par ALTA MARÉE pour ouvrir le webmail, le calendrier et préparer les envois de documents commerciaux.

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

## Envoi des documents PDF

Les documents commerciaux envoyés par email sont transmis en pièce jointe PDF. Le corps du mail reste volontairement simple et ne contient plus le rendu HTML complet du document.

Routes sécurisées :

```http
POST /api/communication/send-delivery-note-email/:id
POST /api/communication/send-invoice-email/:id
```

Payload :

```json
{
  "to": "client@example.fr",
  "subject": "Facture FAC-2026-00003",
  "message": "Bonjour,\n\nVeuillez trouver ci-joint votre facture FAC-2026-00003.\n\nCordialement,\nALTA MARÉE"
}
```

Les PDF sont générés côté backend depuis les templates existants :

- bon de livraison : `deliveryNotePdfTemplate`
- facture client : `customerInvoicePdfTemplate`

## WhatsApp

WhatsApp ouvre WhatsApp Web avec un message prérempli. Les pièces jointes WhatsApp ne sont pas automatisées dans cette PR.

Exemple de message facture :

```text
Bonjour, votre facture FAC-2026-00003 est disponible. Cordialement, ALTA MARÉE.
```

## Préparation des futurs envois

La structure peut ensuite être étendue aux :

- commandes fournisseur
- relances client
- avoirs clients

Les PDF existants ne sont pas modifiés par ce socle. Les futures pièces jointes devront rester générées côté backend, sans exposer les secrets SMTP au navigateur.
