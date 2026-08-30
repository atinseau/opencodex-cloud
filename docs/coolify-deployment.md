# Déploiement Coolify

## 1. Préparer les secrets

Générer deux valeurs indépendantes, sans les committer :

```bash
openssl rand -base64 48
openssl rand -base64 48
```

Créer dans Coolify les variables `OPENCODEX_API_AUTH_TOKEN`,
`OPENCODEX_ADMIN_AUTH_TOKEN`, `OPENCODEX_PUBLIC_ORIGIN` et `TZ`. L'origine doit être exacte, par
exemple `https://ai.example.com`, sans slash final.

## 2. Créer la ressource

Créer une ressource Docker Compose depuis le dépôt et sélectionner `compose.coolify.yaml`. Associer
le domaine HTTPS au service `opencodex`, port `10100`. Ne créer aucun mapping de port hôte.

Le premier démarrage initialise seulement `config.json`; les redémarrages conservent le volume. Un
changement ultérieur de `OPENCODEX_PUBLIC_ORIGIN` ne réécrit pas une configuration existante : mettre
alors `corsAllowOrigins` à jour depuis le dashboard ou dans le volume pendant un arrêt contrôlé.

## 3. Health checks

- `/healthz` : liveness immédiate, utilisée par Docker et Coolify ;
- `/readyz` : disponibilité après synchronisation, à surveiller séparément ; sur la release stable
  `v2.36.0`, un premier boot cloud sans catalogue Codex local peut répondre `503 failed` alors que le
  plan de données est opérationnel. Ne pas l'utiliser comme health check de redémarrage avant la
  publication du mode hub upstream ;
- `/v1/models` : test fonctionnel authentifié ;
- `/v1/catalog` : catalogue authentifié consommable par les machines clientes.

`/healthz` et `/readyz` sont volontairement sans authentification et ne renvoient qu'une identité
sanitisée. Ils ne doivent jamais contenir de provider, de modèle privé ou de secret.

## 4. Premier accès

Ouvrir le domaine, saisir `OPENCODEX_ADMIN_AUTH_TOKEN`, puis configurer les providers. Créer ensuite
une clé de plan de données distincte pour chaque machine dans l'onglet API. Garder la clé
d'environnement comme clé de secours et la faire tourner après l'enrôlement initial.

## 5. Configurer une machine Codex

Copier `examples/codex-config.toml`, remplacer le domaine et le modèle, puis exporter sur la machine
cliente sa clé propre :

```bash
export OPENCODEX_API_AUTH_TOKEN='ocx_machine_key_here'
```

Télécharger le catalogue avec la même clé :

```bash
curl -fsS \
  -H "x-opencodex-api-key: $OPENCODEX_API_AUTH_TOKEN" \
  https://ai.example.com/v1/catalog \
  -o "$HOME/.codex/opencodex-catalog.json"
```

## 6. Sauvegarde

Sauvegarder le volume chiffré, tester la restauration et limiter strictement l'accès aux exports.
Une fuite du volume doit être traitée comme une fuite de tous les providers : révoquer les OAuth,
faire tourner les API keys, les clés machine et les deux secrets de service.
