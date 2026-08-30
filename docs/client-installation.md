# Installation du client

## Parcours utilisateur

Prérequis : macOS ou Linux, Codex installé, et `gh auth status` valide pour lire le dépôt privé.

```bash
gh api -H "Accept: application/vnd.github.raw+json" \
  repos/atinseau/opencodex-cloud/contents/install.sh | sh
```

Le bootstrap détecte l’OS et l’architecture, télécharge le binaire autonome depuis la dernière release,
vérifie `checksums.txt`, l’installe dans `~/.local/bin/opencodex-cloud`, puis ouvre l’assistant Clack.
Bun n’est pas requis sur la machine cliente : il est inclus dans le binaire compilé.

L’assistant demande l’origine du serveur et une clé data-plane propre à la machine. Il effectue ensuite
la séquence suivante :

1. `GET /healthz` sans secret ;
2. `GET /v1/catalog` avec `x-opencodex-api-key` ;
3. écriture atomique du catalogue local ;
4. sauvegarde unique du `config.toml` existant, puis ajout de la configuration gérée ;
5. activation d’un LaunchAgent macOS ou d’un timer systemd utilisateur Linux.

Aucun alias, shim ou remplacement de la commande Codex n’est installé. L’utilisateur lance toujours
`codex`. L’authentification command-backed de Codex appelle silencieusement
`opencodex-cloud auth-token` et le catalogue est lu depuis son chemin local obligatoire.

## Fichiers locaux

| Fichier | Rôle | Permission |
| --- | --- | --- |
| `~/.config/opencodex-cloud/connection.json` | origine et endpoint catalogue | `0600` |
| `~/.config/opencodex-cloud/api-key` | clé de la machine | `0600` |
| `~/.config/opencodex-cloud/sync-state.json` | ETag et dates de synchronisation | `0600` |
| `~/.codex/opencodex-cloud-catalog.json` | cache de modèles validé | `0600` |
| `~/.codex/config.toml.opencodex-cloud.bak` | sauvegarde créée une seule fois | permissions utilisateur |

Les répertoires sont créés en `0700`. `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `CODEX_HOME` et
`OPENCODEX_CLOUD_HOME` sont respectés.

## Commandes de diagnostic

```bash
opencodex-cloud status
opencodex-cloud sync
```

`status` n’affiche jamais la clé. `sync` force une vérification immédiate ; une réponse `304` conserve
le fichier tel quel. Les logs du service sont dans `~/.local/state/opencodex-cloud/` sur macOS ; sous
Linux, ils sont disponibles dans le journal systemd utilisateur.

## Publication des binaires

Le workflow `client` teste le TypeScript, les tests Bun et le bootstrap shell. À chaque release, il
compile quatre binaires autonomes (`darwin/linux`, `arm64/x64`), produit leurs SHA-256 et les joint à
la release. Le même workflow peut être lancé manuellement avec un tag existant pour réparer ou ajouter
les assets d’une release sans changer la version OpenCodex de l’image.
