# WhatsApp Cloud API - ALTA MARÉE

## Objectif

Cette integration relie ALTA MARÉE a Meta WhatsApp Business Cloud API pour deux usages :

- tester la configuration avec le template Meta standard `hello_world` ;
- envoyer des messages texte metier depuis les documents ALTA : commandes client, BL, factures client, commandes fournisseur et cours / mercuriales.

Le frontend ne connait aucune variable WhatsApp. Il envoie uniquement le numero destinataire et le message valide par l'utilisateur a l'API backend authentifiee.

## Architecture

```text
Frontend ALTA
  -> routes /api/communication/whatsapp/*
    -> backend/routes/communication.js
      -> backend/services/whatsappBusinessDocumentService.js
        -> backend/services/whatsappService.js
          -> Meta Graph API /v25.0/{WHATSAPP_PHONE_NUMBER_ID}/messages
```

## Variables serveur utilisees

Les variables suivantes doivent etre presentes dans le `.env` du VPS backend :

- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_BUSINESS_ACCOUNT_ID`
- `WHATSAPP_ACCESS_TOKEN`

Notes securite :

- `WHATSAPP_ACCESS_TOKEN` ne doit jamais etre affiche ni logge.
- Les variables WhatsApp ne doivent jamais etre exposees au frontend.
- Les logs ne contiennent que le type de document, l'id document, un numero masque et le `message_id` Meta.

## Service backend

`backend/services/whatsappService.js` expose :

- `sendTextMessage(to, message)` ;
- `sendTemplateMessage(to, templateName, languageCode)` ;
- `normalizePhoneNumber(phone)` ;
- `maskPhoneNumber(phone)`.

Les numeros sont normalises avant appel Meta. Exemple : `+33612345678` devient `33612345678`.

## Route de test

```http
POST /api/communication/whatsapp/test
Authorization: Bearer <jwt_alta>
Content-Type: application/json
```

Payload :

```json
{
  "to": "+33612345678"
}
```

La route utilise le template Meta standard :

```text
template name: hello_world
language code: en_US
```

Retour succes uniquement si Meta retourne un `message_id` :

```json
{
  "success": true,
  "message_id": "wamid..."
}
```

## Routes metier ajoutees

Toutes les routes sont authentifiees. Les routes d'envoi exigent un profil autorise via `requireAdminOrManager`.

```http
GET  /api/communication/whatsapp/sale/:id/defaults
POST /api/communication/whatsapp/sale/:id

GET  /api/communication/whatsapp/delivery-note/:id/defaults
POST /api/communication/whatsapp/delivery-note/:id

GET  /api/communication/whatsapp/invoice/:id/defaults
POST /api/communication/whatsapp/invoice/:id

GET  /api/communication/whatsapp/purchase/:id/defaults
POST /api/communication/whatsapp/purchase/:id

GET  /api/communication/whatsapp/price-list/defaults
POST /api/communication/whatsapp/price-list
```

Payload commun d'envoi :

```json
{
  "to": "+33612345678",
  "message": "Message valide par utilisateur"
}
```

Payload mercuriale possible :

```json
{
  "client_id": "uuid-client-optionnel",
  "price_list_id": "uuid-mercuriale-optionnel",
  "to": "+33612345678",
  "message": "Message valide par utilisateur"
}
```

## Recuperation des numeros

Le backend tente de recuperer automatiquement un numero dans cet ordre :

- documents client : client facture / client livre, colonnes `mobile` puis `phone` ;
- commande fournisseur : fournisseur, colonnes `mobile` puis `phone` ;
- mercuriale : client rattache a la mercuriale ou client selectionne cote UI, colonnes `mobile` puis `phone`.

Aucune migration SQL n'est necessaire dans cette PR : les colonnes `mobile` et `phone` existent deja sur les fiches clients et fournisseurs.

Si aucun numero n'est disponible, la modale laisse saisir un numero manuel. L'envoi n'est jamais declenche sans confirmation utilisateur.

## Messages par defaut

Commande client :

```text
Bonjour,

Votre commande {reference} a bien été enregistrée.

Cordialement,
ALTA MARÉE
```

BL :

```text
Bonjour,

Votre bon de livraison {reference} est disponible.

Cordialement,
ALTA MARÉE
```

Facture :

```text
Bonjour,

Votre facture {reference} est disponible.

Cordialement,
ALTA MARÉE
```

Commande fournisseur :

```text
Bonjour,

Veuillez trouver notre commande {reference} :

{resume_lignes}

Cordialement,
ALTA MARÉE
```

Cours / mercuriale :

```text
Bonjour,

Voici les cours ALTA MARÉE du jour :

{liste_articles_prix}

Cordialement,
ALTA MARÉE
```

## Limite Meta conversation 24h

Les routes metier envoient du texte libre. Meta peut refuser un message libre si la conversation WhatsApp avec ce destinataire n'est pas ouverte dans la fenetre de 24h.

Dans ce cas, l'API retourne une erreur claire au frontend :

```text
WhatsApp impose l’utilisation d’un modèle/template pour contacter ce numéro hors conversation récente.
```

Templates Meta a prevoir ensuite :

- `facture_disponible`
- `bl_disponible`
- `commande_fournisseur`
- `cours_du_jour`

## Historique

Aucune grosse migration n'est ajoutee dans cette PR. Un TODO est laisse cote service pour enregistrer l'historique `type=whatsapp` quand une table de journal communication sera disponible.

## Procedure de test

1. Verifier que le test `hello_world` fonctionne toujours depuis la Home.
2. Ouvrir une commande client et utiliser `💬 Envoyer commande WhatsApp`.
3. Ouvrir un BL et utiliser `💬 Envoyer BL WhatsApp`.
4. Ouvrir une facture client et utiliser `💬 Envoyer facture WhatsApp`.
5. Ouvrir un achat fournisseur et utiliser `💬 Envoyer commande fournisseur WhatsApp`.
6. Ouvrir Cours / Mercuriale et utiliser `💬 Envoyer les cours WhatsApp`.
7. Verifier le cas sans numero fiche : la modale doit demander un numero manuel.
8. Verifier le cas Meta hors fenetre 24h : l'erreur template doit etre lisible.

## Hors perimetre

- Pas de webhook WhatsApp entrant.
- Pas de PDF joint WhatsApp.
- Pas de modification des ventes, achats, stocks, BL, factures ou calculs metier.
- Pas de modification des secrets ou du `.env`.
