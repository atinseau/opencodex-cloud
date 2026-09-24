# Architecture cible

## Flux principal

```text
Codex / Claude Code / harness
        |
        | HTTPS + clé propre à la machine
        v
Coolify reverse proxy (TLS, aucun port hôte publié)
        |
        | réseau Docker privé
        v
OpenCodex Cloud :10100
        |-- plan de données /v1/*
        |-- plan d'administration /api/* + dashboard
        |-- catalogue et routage centralisés
        v
OpenAI / Anthropic / Gemini / OpenRouter / autres providers
```

Le plan de données et le plan d'administration utilisent deux secrets différents. Les credentials
des providers et les jetons OAuth sont persistés dans le volume `opencodex-data`. Le reverse proxy
Coolify est le seul composant exposé : le compose utilise `expose`, jamais `ports`.

La release stable exécute encore une synchronisation de profil Codex local au démarrage. L'entrypoint
crée donc un `CODEX_HOME` minimal et isolé dans le volume. Le Codex CLI officiel embarqué expose son
catalogue natif avec `codex debug models --bundled` ; OpenCodex le fusionne avec la découverte live
des providers et matérialise le résultat dans ce volume. Il n'existe aucune seed de modèles dans ce
dépôt et le profil Codex d'une machine cliente n'est jamais monté dans le conteneur.

Les routes de gestion des providers, modèles, aliases et comptes déclenchent la convergence native
d'OpenCodex après chaque mutation. Un réconciliateur Bun appelle en plus `POST /api/sync` uniquement
sur `127.0.0.1`, toutes les cinq minutes par défaut, afin de capter un changement survenu directement
chez un provider. Le token d'administration reste dans l'environnement du processus et n'apparaît ni
dans l'URL, ni dans les arguments, ni dans les logs. Les exécutions concurrentes sont coalescées.

Sur chaque machine cliente, le binaire autonome `opencodex-cloud` utilise uniquement le plan de
données : il lit `GET /v1/catalog` avec la clé de la machine, conserve un cache local atomique puis
configure Codex avec `model_catalog_json`. Un timer launchd ou systemd utilisateur vérifie l’ETag
toutes les 30 secondes. Codex obtient son bearer token via `model_providers.opencodex_cloud.auth` :
la clé n’est ni copiée dans `config.toml`, ni exportée globalement dans le shell, et l’utilisateur
continue de lancer la commande standard `codex`.

Le routage client forme un basculement réversible. `connect` capture uniquement les clés racine
`model_provider` et `model_catalog_json` qu’il remplace, puis marque ses propres blocs. `disconnect`
arrête la synchronisation et restaure ces fragments sans remplacer le reste du fichier. Un OpenCodex
local éventuellement actif reste indépendant dans `~/.opencodex` et peut reprendre immédiatement la
main.

## Choix de version

L'image installe directement `@bitkyc08/opencodex@2.64.0` et `@openai/codex@0.151.0` avec Bun
`1.4.2`. Elle conserve uniquement le binaire Codex natif nécessaire au catalogue, sans ses outils
agent/sandbox inutilisés par le proxy. Il n'y a ni clone Git ni compilation de l'application dans
l'image. La route de lecture
`GET /v1/catalog` est déjà présente dans `2.36.0`, indépendamment de la chaîne de pairing. L'upstream
développe encore le vrai mode `hub/client` dans les PR #2771, #2772, #2776, #2777, #2781, #2786 et
#2789. Elles ne sont pas encore toutes fusionnées au 30 août 2026. Nous n'en copions pas le protocole
privé : le dépôt pourra basculer vers ce mode après sa publication stable.

## Persistance et sauvegarde

Le volume contient au minimum `config.json`, `auth.json`, `codex-accounts.json`, le jeton admin
fichier éventuel, les catalogues et les journaux. `auth.json` et `codex-accounts.json` peuvent contenir
des refresh tokens. Le mode `0600` protège contre les autres utilisateurs du conteneur, pas contre
un administrateur de l'hôte ni contre une sauvegarde non chiffrée.
