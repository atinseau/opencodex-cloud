# opencodex-cloud

Image Bun durcie et recette Coolify pour centraliser providers, modèles, OAuth et routage OpenCodex,
puis connecter plusieurs machines à un endpoint unique.

## État

- upstream : [`lidge-jun/opencodex`](https://github.com/lidge-jun/opencodex) ;
- package officiel épinglé : `@bitkyc08/opencodex@2.36.0` ;
- catalogue natif épinglé : `@openai/codex@0.151.0` ;
- runtime : Bun `1.4.0` ;
- cible : Docker Compose / Coolify ;
- exposition : HTTPS uniquement, sans port hôte publié ;
- authentification : clés séparées données/admin, puis une clé par machine.

## Connecter une machine

Le dépôt est privé : la machine doit avoir `gh` installé et authentifié, ainsi qu’une version récente
de Codex. L’installation tient en une commande :

```bash
gh api -H "Accept: application/vnd.github.raw+json" \
  repos/atinseau/opencodex-cloud/contents/install.sh | sh
```

L’assistant [Clack](https://bomb.sh/docs/clack/basics/getting-started/) demande seulement :

1. l’adresse HTTPS du serveur ;
2. la clé API dédiée à cette machine.

Il ne faut lancer ni `opencodex init` ni `ocx init` sur la machine cliente : ces commandes préparent
un proxy OpenCodex local. Le conteneur cloud est initialisé par son entrypoint et le client est
configuré directement par cet installateur.

Il teste le serveur et la clé, télécharge le catalogue, configure Codex puis active la synchronisation
automatique. Ensuite, l’utilisateur lance simplement :

```bash
codex
```

Si Codex utilise déjà un OpenCodex local, l’assistant le détecte et demande une confirmation avant
le basculement. Le processus local n’est ni arrêté ni modifié : seul le routage racine de Codex passe
temporairement sur le Cloud. Pour restaurer le provider et le catalogue précédents :

```bash
opencodex-cloud disconnect
```

La restauration est ciblée et conserve les autres changements effectués entre-temps dans
`config.toml`. Une nouvelle commande `connect` permet ensuite de reprendre la main côté Cloud.

Le catalogue local est vérifié toutes les 30 secondes avec ETag. Une mise à jour est écrite
atomiquement ; une réponse invalide ne remplace jamais la dernière version valide. Codex charge ce
catalogue au démarrage, donc un processus déjà ouvert voit les nouveaux modèles à son prochain
lancement.

Le serveur ne contient aucune liste de modèles maintenue à la main. OpenCodex matérialise son
catalogue depuis le catalogue officiel du Codex CLI embarqué, puis le fusionne avec la découverte
des providers, les aliases, les modèles activés et les droits des comptes connectés. Les mutations
du dashboard convergent immédiatement ; une réconciliation interne toutes les cinq minutes couvre
aussi les changements apparus directement chez un provider.

Pour vérifier toute la chaîne après installation :

```bash
opencodex-cloud doctor
```

Le doctor indique qui a réellement la main — Cloud, OpenCodex local ou autre provider — et détecte
un proxy local actif mais inutilisé. En mode Cloud, il contrôle aussi la configuration locale, les
permissions de la clé, le catalogue, le service de synchronisation, `/healthz`, `/readyz`,
l’authentification data-plane et la connexion bearer utilisée par Codex sur `/v1/models`. Il ne lance
aucune inférence payante.

Voir [Installation du client](docs/client-installation.md) pour le fonctionnement, les chemins et le
dépannage.

## Démarrage local de validation

```bash
cp .env.example .env
# Remplacer toutes les valeurs dans .env avant de continuer.
docker compose -f compose.coolify.yaml up --build
```

Le dashboard écoute sur le port interne `10100`. Pour un test local ponctuel, ajouter un override
Compose séparé qui publie le port sur `127.0.0.1` seulement ; ne pas modifier le fichier Coolify.

## Documentation

- [Architecture](docs/architecture.md)
- [Sécurité](docs/security.md)
- [Déploiement Coolify](docs/coolify-deployment.md)
- [Configuration Codex](examples/codex-config.toml)
- [Installation du client](docs/client-installation.md)
- [Analyse de l'upstream](docs/research/opencodex-upstream.md)

## Limite importante

Le pairing `remote-hub` officiel d'OpenCodex est encore en revue upstream. Le client de ce dépôt ne
copie pas ce protocole privé : il utilise le bind distant stable et l’endpoint data-plane
`GET /v1/catalog` déjà publié dans OpenCodex `2.36.0`, avec une clé existante créée par
l’administrateur. L’émission et la révocation automatisées des clés pourront adopter le pairing
officiel lorsqu’il sera publié.
