# Variables d'environnement communication

Ce socle ajoute l'envoi de bons de livraison par email et par WhatsApp Cloud API depuis le module Vente.

Ne pas stocker ces valeurs dans le code source. Elles doivent etre configurees dans `backend/.env` sur chaque environnement.

## SMTP email

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=contact@example.com
SMTP_PASS=mot_de_passe_smtp
SMTP_FROM_NAME=Scorpa Seafood
SMTP_FROM_EMAIL=contact@example.com
```

Notes :

- `SMTP_SECURE=false` est le cas courant pour le port `587` avec STARTTLS.
- `SMTP_SECURE=true` est le cas courant pour le port `465`.
- `SMTP_FROM_EMAIL` doit generalement correspondre au domaine autorise par le fournisseur SMTP.

## WhatsApp Cloud API officielle

```env
WHATSAPP_API_HOST=graph.facebook.com
WHATSAPP_API_VERSION=v20.0
WHATSAPP_ACCESS_TOKEN=token_meta_cloud_api
WHATSAPP_PHONE_NUMBER_ID=id_du_numero_whatsapp
WHATSAPP_BUSINESS_ACCOUNT_ID=id_du_business_account
WHATSAPP_DEFAULT_LANGUAGE=fr
WHATSAPP_DEFAULT_COUNTRY_CODE=33
WHATSAPP_DELIVERY_NOTE_TEMPLATE_NAME=delivery_note_available
```

Le socle utilise un message de type `template` pour rester compatible avec les regles de la Cloud API.

Le template `WHATSAPP_DELIVERY_NOTE_TEMPLATE_NAME` doit etre cree et approuve dans Meta. Le premier cas d'usage BL envoie trois variables dans le corps du template :

1. nom du client ;
2. reference du bon de livraison ;
3. date du bon de livraison.

Exemple de corps de template compatible :

```text
Bonjour {{1}}, votre bon de livraison {{2}} du {{3}} est disponible.
```

## Perimetre actuel

Inclus maintenant :

- envoi email HTML simple d'un BL ;
- envoi WhatsApp Cloud API par template lie au BL ;
- activation des boutons existants dans `sale-detail.html` uniquement quand un contact client est disponible.

Hors perimetre de cette etape :

- piece jointe PDF BL ;
- creation et gestion avancee des templates WhatsApp ;
- webhook de reponses clients ;
- module tarifs ;
- ventes flash ;
- relation client avancee.
