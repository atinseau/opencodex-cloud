# Déploiement Coolify

## 1. Préparer les secrets

Générer deux valeurs indépendantes, sans les committer :

```bash
openssl rand -base64 48
openssl rand -base64 48
```

Créer dans Coolify les variables `OPENCODEX_API_AUTH_TOKEN`,
`OPENCODEX_ADMIN_AUTH_TOKEN`, `OPENCODEX_PUBLIC_ORIGIN`, `CATALOG_SYNC_INTERVAL_SECONDS` et `TZ`.
L'origine doit être exacte, par exemple `https://ai.example.com`, sans slash final. L'intervalle
vaut `300` secondes par défaut, accepte `0` pour désactiver la réconciliation périodique et refuse
une valeur active inférieure à 30 secondes.

## 2. Créer la ressource

Créer une ressource Docker Compose depuis le dépôt et sélectionner `compose.coolify.yaml`. Associer
le domaine HTTPS au service `opencodex`, port `10100`. Ne créer aucun mapping de port hôte.

Le premier démarrage initialise `config.json`, un profil Codex isolé et le catalogue matérialisé à
partir du Codex CLI officiel. Les redémarrages conservent le volume. Un changement ultérieur de
`OPENCODEX_PUBLIC_ORIGIN` ne réécrit pas une configuration existante : mettre alors
`corsAllowOrigins` à jour depuis le dashboard ou dans le volume pendant un arrêt contrôlé.

## 3. Health checks

- `/healthz` : liveness immédiate, utilisée par Docker et Coolify ;
- `/readyz` : disponibilité après matérialisation et synchronisation du catalogue ; un `503` indique
  désormais un véritable échec de convergence à diagnostiquer ;
- `/v1/models` : test fonctionnel authentifié ;
- `/v1/catalog` : catalogue authentifié consommable par les machines clientes.

`/healthz` et `/readyz` sont volontairement sans authentification et ne renvoient qu'une identité
sanitisée. Ils ne doivent jamais contenir de provider, de modèle privé ou de secret.

## 4. Premier accès

Ouvrir le domaine, saisir `OPENCODEX_ADMIN_AUTH_TOKEN`, puis configurer les providers. Créer ensuite
une clé de plan de données distincte pour chaque machine dans l'onglet API. Garder la clé
d'environnement comme clé de secours et la faire tourner après l'enrôlement initial.

## 5. Configurer une machine Codex

Lancer l'installateur depuis une machine où `gh` est authentifié :

```bash
gh api -H "Accept: application/vnd.github.raw+json" \
  repos/atinseau/opencodex-cloud/contents/install.sh | sh
```

Le prompt demande l'origine HTTPS et une clé propre à cette machine. Il télécharge le catalogue,
configure le provider Codex, garde la clé hors de `config.toml` et installe la synchronisation ETag
toutes les 30 secondes. Le fichier local n'est qu'un cache ; OpenCodex Cloud reste la source de
vérité. `opencodex-cloud disconnect` restaure le routage antérieur.

## 6. Sauvegarde

Sauvegarder le volume chiffré, tester la restauration et limiter strictement l'accès aux exports.
Une fuite du volume doit être traitée comme une fuite de tous les providers : révoquer les OAuth,
faire tourner les API keys, les clés machine et les deux secrets de service.
