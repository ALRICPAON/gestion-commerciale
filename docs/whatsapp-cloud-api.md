# WhatsApp Cloud API - Integration test ALTA

## Objectif

Cette integration ajoute un premier test d'envoi WhatsApp depuis ALTA MARÉE pour valider la configuration Meta WhatsApp Business Cloud API.

Le test envoie le message fixe suivant au numero saisi depuis la Home:

```text
Bonjour depuis ALTA MARÉE 🚀
```

## Architecture

```text
Home ALTA
  -> POST /api/communication/whatsapp/test
    -> backend/routes/communication.js
      -> backend/services/whatsappService.js
        -> Meta Graph API /v25.0/{WHATSAPP_PHONE_NUMBER_ID}/messages
```

Le frontend ne connait aucune variable WhatsApp. Il envoie uniquement le numero destinataire a l'API backend authentifiee.

## Variables serveur utilisees

Les variables suivantes doivent etre presentes dans le `.env` du VPS backend:

- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_BUSINESS_ACCOUNT_ID`
- `WHATSAPP_ACCESS_TOKEN`

Notes:

- `WHATSAPP_ACCESS_TOKEN` ne doit jamais etre affiche ni logge.
- Les variables WhatsApp ne doivent jamais etre exposees au frontend.
- `WHATSAPP_BUSINESS_ACCOUNT_ID` est conservee pour la configuration Meta, meme si le test d'envoi utilise directement `WHATSAPP_PHONE_NUMBER_ID`.

## Route de test

```http
POST /api/communication/whatsapp/test
Authorization: Bearer <jwt_alta>
Content-Type: application/json
```

Payload:

```json
{
  "to": "+33612345678"
}
```

Retour succes:

```json
{
  "success": true
}
```

Retour erreur exemple:

```json
{
  "success": false,
  "error": "Numero WhatsApp destinataire invalide"
}
```

## Procedure de test depuis ALTA

1. Se connecter a ALTA avec un compte admin.
2. Ouvrir la Home.
3. Dans la carte Communication, cliquer sur `💬 Envoyer test WhatsApp`.
4. Saisir un numero au format international, par exemple `+33612345678`.
5. Verifier que le message est recu sur le telephone cible.
6. En cas d'erreur, verifier le message affiche dans la carte Communication et les logs backend sans jamais afficher le token.

## Procedure de test API

Exemple cURL depuis un environnement autorise:

```bash
curl -X POST "$API_BASE_URL/api/communication/whatsapp/test" \
  -H "Authorization: Bearer $ALTA_JWT" \
  -H "Content-Type: application/json" \
  -d '{"to":"+33612345678"}'
```

## Securite

- Le token Meta reste uniquement cote backend.
- La route ne renvoie jamais de token ni de configuration WhatsApp.
- Les logs backend ne journalisent que le message d'erreur et le statut HTTP.
- Les erreurs Meta sont simplifiees avant retour API.

## Hors perimetre

- Pas de webhook WhatsApp entrant.
- Pas de templates conversationnels ajoutes.
- Pas de modification des modules metier.
- Pas de migration SQL necessaire.
