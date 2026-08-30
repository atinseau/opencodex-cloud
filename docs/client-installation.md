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
4. détection d’un routage ou proxy OpenCodex local et confirmation explicite du basculement ;
5. enregistrement privé des seules valeurs racine qui seront remplacées, puis ajout de la
   configuration gérée ;
6. activation d’un LaunchAgent macOS ou d’un timer systemd utilisateur Linux.

L’origine Cloud doit être distante et en HTTPS. Une origine loopback est refusée par l’assistant afin
d’éviter qu’un proxy local soit pris pour le bastion. Elle n’est disponible que pour les tests
explicites avec `OPENCODEX_CLOUD_ALLOW_LOOPBACK=1`.

Aucun alias, shim ou remplacement de la commande Codex n’est installé. L’utilisateur lance toujours
`codex`. L’authentification command-backed de Codex appelle silencieusement
`opencodex-cloud auth-token` et le catalogue est lu depuis son chemin local obligatoire.

`opencodex init`/`ocx init` n’est pas lancé sur le client. Cette commande upstream initialise un proxy
local, ce qui serait l’inverse de l’architecture recherchée. Le serveur Docker possède déjà son profil
isolé et sa configuration minimale ; les providers sont ensuite administrés sur le serveur.

## Fichiers locaux

| Fichier | Rôle | Permission |
| --- | --- | --- |
| `~/.config/opencodex-cloud/connection.json` | origine et endpoint catalogue | `0600` |
| `~/.config/opencodex-cloud/api-key` | clé de la machine | `0600` |
| `~/.config/opencodex-cloud/sync-state.json` | ETag et dates de synchronisation | `0600` |
| `~/.config/opencodex-cloud/routing-state.json` | provider/catalogue restaurés par `disconnect` | `0600` |
| `~/.codex/opencodex-cloud-catalog.json` | cache de modèles validé | `0600` |
| `~/.codex/config.toml.opencodex-cloud.bak` | sauvegarde créée une seule fois | permissions utilisateur |

Les répertoires sont créés en `0700`. `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `CODEX_HOME` et
`OPENCODEX_CLOUD_HOME` sont respectés.

## Commandes de diagnostic

```bash
opencodex-cloud status
opencodex-cloud sync
opencodex-cloud doctor
opencodex-cloud doctor --json
opencodex-cloud disconnect
```

`status` n’affiche jamais la clé. `sync` force une vérification immédiate ; une réponse `304` conserve
le fichier tel quel. Les logs du service sont dans `~/.local/state/opencodex-cloud/` sur macOS ; sous
Linux, ils sont disponibles dans le journal systemd utilisateur.

`doctor` détermine d’abord le routage réellement actif. Il vérifie également le port OpenCodex local
configuré, ou `127.0.0.1:10100` par défaut. En mode Cloud, un proxy local encore actif produit un
avertissement sans bloquer ; une origine Cloud qui pointe vers localhost est un échec. Les contrôles
Cloud couvrent ensuite la clé et ses permissions, le `config.toml`, le cache local, le timer, la
fraîcheur de la synchronisation, `/healthz`, `/readyz`, `/v1/catalog` et `/v1/models`. Il ne contacte
aucun provider et ne déclenche donc aucune requête modèle payante. `--json` rend le résultat
exploitable par un script de support ou une supervision locale ; la clé n’apparaît jamais dans la
sortie.

`disconnect` arrête le LaunchAgent/timer Cloud, retire les blocs gérés et restaure uniquement le
provider et le catalogue capturés avant `connect`. Les autres modifications de `config.toml` sont
préservées. Le proxy OpenCodex local n’est jamais arrêté par le client. La configuration de connexion
et la clé Cloud restent privées sur la machine pour permettre une reconnexion ultérieure.

## Publication des binaires

Le workflow `client` teste le TypeScript, les tests Bun et le bootstrap shell. À chaque release, il
compile quatre binaires autonomes (`darwin/linux`, `arm64/x64`), produit leurs SHA-256 et les joint à
la release. Le même workflow peut être lancé manuellement avec un tag existant pour réparer ou ajouter
les assets d’une release sans changer la version OpenCodex de l’image.
