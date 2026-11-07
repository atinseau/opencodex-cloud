# Modèle de sécurité

## Hub

- Coolify termine TLS. Aucun port n'est publié sur l'hôte ; seul Traefik joint le port `10100`.
- `OPENCODEX_API_AUTH_TOKEN` protège le plan de données et `OPENCODEX_ADMIN_AUTH_TOKEN` le dashboard
  et `/api/*`. OpenCodex refuse d'écouter hors loopback sans clé de plan de données.
- Chaque client reçoit sa propre clé, créée dans le dashboard, pour pouvoir la révoquer seule.
- Le volume contient les jetons OAuth des comptes connectés : il doit être sauvegardé chiffré. Une
  fuite du volume impose de révoquer les comptes et de faire tourner toutes les clés.

## Connecteur Claude

- Le connecteur ne reçoit qu'une clé de plan de données du hub. Il n'a accès ni au volume du hub, ni
  aux jetons des comptes, ni à l'administration.
- Claude s'authentifie comme client OAuth confidentiel : PKCE S256 obligatoire, redirection limitée à
  `https://claude.ai/api/mcp/auth_callback` et au loopback de Claude Code, codes à usage unique valables
  une minute.
- Les jetons sont signés en HMAC-SHA256 avec une clé dérivée du secret client. Un jeton d'accès vit
  une heure et un refresh token trente jours. Changer `MCP_OAUTH_CLIENT_SECRET` révoque tous les
  jetons d'un coup.
- Les liens d'images contiennent un identifiant aléatoire de 256 bits : quiconque possède le lien
  peut télécharger l'image jusqu'à sa suppression, après `MCP_IMAGE_RETENTION`.
- Toute personne qui connaît le secret client peut générer des images sur le compte ChatGPT du hub.

## Conteneurs

Les deux images tournent avec l'utilisateur non privilégié `bun`, sans capability Linux, avec
`no-new-privileges`, une racine en lecture seule et un `/tmp` éphémère. Ces options sont celles de
`compose.yaml` et doivent être reportées dans les options `docker run` de chaque application
Coolify, qui n'applique pas le fichier Compose. Les images de base sont épinglées par digest, et la CI
analyse les deux images avec Trivy.
