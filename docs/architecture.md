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
crée donc un `CODEX_HOME` minimal et isolé dans le volume. Il satisfait ce contrat sans jamais monter
ni modifier le profil Codex d'une machine cliente.

Sur chaque machine cliente, le binaire autonome `opencodex-cloud` utilise uniquement le plan de
données : il lit `GET /v1/catalog` avec la clé de la machine, conserve un cache local atomique puis
configure Codex avec `model_catalog_json`. Un timer launchd ou systemd utilisateur vérifie l’ETag
toutes les 30 secondes. Codex obtient son bearer token via `model_providers.opencodex_cloud.auth` :
la clé n’est ni copiée dans `config.toml`, ni exportée globalement dans le shell, et l’utilisateur
continue de lancer la commande standard `codex`.

## Choix de version

L'image installe directement le package officiel `@bitkyc08/opencodex@2.36.0` avec Bun `1.4.0`.
Il n'y a ni clone Git ni compilation de l'application dans l'image. La route de lecture
`GET /v1/catalog` est déjà présente dans `2.36.0`, indépendamment de la chaîne de pairing. L'upstream
développe encore le vrai mode `hub/client` dans les PR #2771, #2772, #2776, #2777, #2781, #2786 et
#2789. Elles ne sont pas encore toutes fusionnées au 30 août 2026. Nous n'en copions pas le protocole
privé : le dépôt pourra basculer vers ce mode après sa publication stable.

## Persistance et sauvegarde

Le volume contient au minimum `config.json`, `auth.json`, `codex-accounts.json`, le jeton admin
fichier éventuel, les catalogues et les journaux. `auth.json` et `codex-accounts.json` peuvent contenir
des refresh tokens. Le mode `0600` protège contre les autres utilisateurs du conteneur, pas contre
un administrateur de l'hôte ni contre une sauvegarde non chiffrée.
