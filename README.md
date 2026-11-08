# opencodex-cloud

Déploiement Coolify d'un hub [OpenCodex](https://github.com/lidge-jun/opencodex) et d'un connecteur
Claude qui expose la génération et la retouche d'image de ce hub à Claude Desktop, claude.ai et
Claude Code.

| Chemin               | Rôle                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------- |
| `Dockerfile`         | Image du hub : OpenCodex 2.98.0 et Codex CLI 0.167.0, depuis npm, sur Bun 1.4.4       |
| `docker/config.json` | Configuration initiale du hub, copiée dans un volume vide                             |
| `packages/mcp`       | Connecteur MCP pour Claude (Bun, TypeScript, Effect), image `packages/mcp/Dockerfile` |
| `compose.yaml`       | Validation locale des deux conteneurs avec le durcissement de production              |
| `docker/smoke.sh`    | Test de fumée des deux images, lancé par la CI                                        |

Le hub est l'OpenCodex amont, sans surcouche. Le routage, les comptes, le rafraîchissement horaire du
catalogue et l'appairage des machines (`ocx hub invite`, `ocx connect`) viennent de l'upstream.
L'image ajoute seulement le binaire Codex natif, dont OpenCodex a besoin pour générer son catalogue
de modèles, et place tout l'état dans le volume `/var/lib/opencodex`.

Le connecteur tourne dans un conteneur séparé et parle au hub par le réseau Docker privé de Coolify.
Il propose quatre outils. `generate_image` crée une image à partir d'un texte et `edit_image` modifie
une image, ou en combine jusqu'à quatre, à partir de leurs liens ; les deux renvoient un aperçu à
Claude et un lien vers le PNG complet. `view_image` montre à Claude les images d'un lien avant qu'il
les retouche, et `request_image_upload` donne à l'utilisateur un lien d'envoi à usage unique, pour
retoucher une de ses propres images.
Le choix est expliqué dans [ADR 0001](docs/adr/0001-mcp-companion-container.md).

## Développement

```bash
bun install
bun run check          # format, types, lint, Knip et tests
cp .env.example .env   # puis renseigner les secrets
docker compose up --build
sh docker/smoke.sh     # construit et vérifie les deux images
```

Le connecteur se lance aussi seul avec `bun run --filter @opencodex-cloud/mcp serve` et les
variables décrites dans [le guide de déploiement](docs/deployment.md#connecteur-claude).

## Mettre à jour OpenCodex, Codex ou Bun

Modifier `OPENCODEX_VERSION`, `CODEX_VERSION` ou le digest `BUN_IMAGE` dans le `Dockerfile`
(et `BUN_IMAGE` dans `packages/mcp/Dockerfile` pour Bun), puis lancer `sh docker/smoke.sh`. Le
build vérifie que le catalogue natif de Codex n'est pas vide, sans dépendre d'une liste de modèles.

## Documentation

- [Déploiement Coolify et connexion à Claude](docs/deployment.md)
- [Modèle de sécurité](docs/security.md)
- [ADR 0001 : connecteur dans un conteneur dédié](docs/adr/0001-mcp-companion-container.md)
