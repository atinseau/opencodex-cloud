# opencodex-cloud

Image Bun durcie et recette Coolify pour centraliser providers, modèles, OAuth et routage OpenCodex,
puis connecter plusieurs machines à un endpoint unique.

## État

- upstream : [`lidge-jun/opencodex`](https://github.com/lidge-jun/opencodex) ;
- package officiel épinglé : `@bitkyc08/opencodex@2.36.0` ;
- runtime : Bun `1.4.0` ;
- cible : Docker Compose / Coolify ;
- exposition : HTTPS uniquement, sans port hôte publié ;
- authentification : clés séparées données/admin, puis une clé par machine.

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
- [Analyse de l'upstream](docs/research/opencodex-upstream.md)

## Limite importante

Le mode remote-hub officiel d'OpenCodex est encore en revue upstream. Cette version utilise le bind
distant stable et une configuration cliente manuelle. Elle évite de dépendre d'un protocole de
pairing non publié et sera migrée lorsque le mode hub sera fusionné et publié.
