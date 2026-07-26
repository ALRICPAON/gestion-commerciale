# Securite Agent ALTA

Regles appliquees:

- `store_id` vient du contexte authentifie, jamais du modele.
- Permissions par outil via `requiredPermission`.
- Autorisation finale: permissions utilisateur ET permissions agent configurees ET niveau de risque.
- Seuls `admin` et `administrator` peuvent contourner l absence de permission explicite cote utilisateur. `manager` et `responsable` doivent avoir les permissions reelles.
- Risques 0 a 3 avec confirmation obligatoire pour les actions engageantes.
- Audit avec masquage des cles, tokens, mots de passe, JWT, cles OpenAI/Pennylane et donnees bancaires sensibles.
- Taille d entree limitee dans l executeur.
- Aucun outil generique SQL, shell, route arbitraire ou suppression arbitraire.
- Le contenu des pieces jointes doit etre traite comme donnee metier, jamais comme instruction systeme.

Variables:

- `AI_AGENT_MAX_TOOL_STEPS=20`
- `AI_AGENT_MAX_TOOL_TIME_MS=45000`
- `ALTA_AGENT_PERMISSIONS=agent.use,clients.read,...`
- `ALTA_AGENT_USER_ID=<uuid optionnel>`
- `ALTA_AGENT_TRUSTED_MODE=false`

Les permissions agent par defaut sont en lecture et `agent.use`. Les ecritures agent doivent etre accordees explicitement. La variable `ALTA_AGENT_PERMISSIONS` ne peut pas donner davantage de droits que l utilisateur authentifie.

En mode proprietaire `ALTA_AGENT_TRUSTED_MODE=true`, les controles de permissions et confirmations MCP sont consideres comme valides pour l agent ALTA du proprietaire. Les protections conservees restent: isolation `store_id`, allowlist d actions metier, validation payload, services metier obligatoires, audit, absence de SQL libre, absence de shell et absence d acces aux secrets.

Le contexte MCP et le contexte assistant interne conservent separement `user_permissions` et `agent_permissions`. En cas de refus, le log securise contient uniquement l outil, la permission requise, le role, les listes de permissions et la source.
