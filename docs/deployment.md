# Déploiement Coolify

Les deux applications vivent dans le même projet Coolify, sur le même serveur et le réseau Docker
`coolify`. Elles se déploient depuis ce dépôt avec le build pack Dockerfile.

## Hub OpenCodex

| Réglage                    | Valeur                                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Dockerfile                 | `/Dockerfile`                                                                                                                                 |
| Port exposé                | `10100`                                                                                                                                       |
| Domaine                    | l'origine publique du hub, par exemple `https://opencodex.example.com`                                                                        |
| Stockage persistant        | volume monté sur `/var/lib/opencodex`                                                                                                         |
| Consistent Container Names | activé : OpenCodex verrouille son journal de dépenses et deux conteneurs ne peuvent pas partager le volume                                    |
| Watch paths                | `Dockerfile` et `docker/**`                                                                                                                   |
| Options `docker run`       | `--init --read-only --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m --cap-drop ALL --security-opt no-new-privileges:true --ulimit nproc=256:256` |

Variables d'environnement :

- `OPENCODEX_API_AUTH_TOKEN` : clé du plan de données, au moins 32 caractères ;
- `OPENCODEX_ADMIN_AUTH_TOKEN` : clé d'administration, différente de la précédente ;
- `TZ` : fuseau des journaux.

Un volume vide reçoit `docker/config.json` au premier démarrage. OpenCodex génère ensuite le
catalogue de modèles à la première synchronisation (au plus tard trois minutes après le démarrage),
puis le rafraîchit toutes les heures. Un volume existant garde sa configuration.

Sur un volume entièrement neuf, OpenCodex 2.98 perd parfois une course au premier démarrage :
`/readyz` reste alors à `failed` alors que `/healthz` répond. Un redémarrage du conteneur suffit et
les démarrages suivants sont propres. Un volume existant, comme celui de la production, n'est pas
concerné : une mise à jour depuis la 2.76 démarre directement `ready`.

`/healthz` sert à la liveness, `/readyz` à la disponibilité. `/v1/models` avec une clé valide
confirme qu'un compte est connecté.

## Connecteur Claude

Le connecteur peut partager le domaine du hub : il n'occupe que le chemin de son endpoint, par
exemple `/mcp`, et trois documents de découverte OAuth suffixés par ce chemin. Le reste du domaine
continue d'aller au hub, car Traefik préfère les routes les plus spécifiques.

| Réglage              | Valeur                                                             |
| -------------------- | ------------------------------------------------------------------ |
| Dockerfile           | `/packages/mcp/Dockerfile`, base directory `/`                     |
| Port exposé          | `8080`                                                             |
| Domaines             | voir ci-dessous                                                    |
| Advanced > Proxy     | **Keep paths as-is** : le connecteur doit recevoir `/mcp`, pas `/` |
| Stockage persistant  | volume monté sur `/data`                                           |
| Watch paths          | `packages/mcp/**`, `package.json`, `bun.lock` et `bunfig.toml`     |
| Options `docker run` | les mêmes que pour le hub                                          |

Domaines pour un endpoint `https://opencodex.example.com/mcp` :

```text
https://opencodex.example.com/mcp
https://opencodex.example.com/.well-known/oauth-protected-resource/mcp
https://opencodex.example.com/.well-known/oauth-authorization-server/mcp
https://opencodex.example.com/.well-known/openid-configuration/mcp
```

Avec un domaine dédié, un seul domaine suffit, par exemple `https://mcp.example.com`.

Variables d'environnement :

- `MCP_PUBLIC_URL` : l'URL exacte de l'endpoint saisie dans Claude, sans slash final, par exemple
  `https://opencodex.example.com/mcp`. Toutes les routes du connecteur sont montées sous ce chemin ;
- `MCP_OAUTH_CLIENT_ID` : identifiant saisi dans Claude, par exemple `claude` ;
- `MCP_OAUTH_CLIENT_SECRET` : secret d'au moins 32 caractères (`openssl rand -hex 32`) ;
- `OPENCODEX_URL` : adresse interne du hub, `http://<nom du conteneur du hub>:10100` ;
- `OPENCODEX_API_KEY` : clé du plan de données créée pour le connecteur dans le dashboard du hub ;
- `MCP_IMAGE_RETENTION` : durée de conservation des images, `7 days` par défaut.

## Ajouter le connecteur dans Claude

1. Dans Claude, ouvrir **Personnaliser > Connecteurs**, puis **Ajouter un connecteur personnalisé**.
2. Saisir l'URL `MCP_PUBLIC_URL`.
3. Dans les paramètres avancés, choisir son propre client OAuth et saisir `MCP_OAUTH_CLIENT_ID` et
   `MCP_OAUTH_CLIENT_SECRET`.
4. Cliquer sur **Connecter**. Le serveur approuve la demande sans page intermédiaire : seul un client
   qui connaît le secret peut échanger le code obtenu.

Claude Code peut utiliser le même client OAuth : sa redirection loopback est acceptée.

Les outils sont ensuite disponibles dans les conversations où le connecteur est activé. Claude
reçoit un aperçu JPEG de l'image et un lien vers le PNG original, valable pendant
`MCP_IMAGE_RETENTION`.

## Vérifier un déploiement

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://opencodex.example.com/mcp   # 401
curl -fsS https://opencodex.example.com/.well-known/oauth-protected-resource/mcp
curl -fsS https://opencodex.example.com/.well-known/oauth-authorization-server/mcp
curl -fsS https://opencodex.example.com/healthz                                   # le hub
```
