# OpenCodex upstream — état des lieux pour une cible cloud

Date d'observation : 30 août 2026. Ce document distingue les **faits observés** dans les sources amont des **recommandations** pour `opencodex-cloud`.

## Périmètre et sources

Sources primaires consultées :

- [README amont](https://github.com/lidge-jun/opencodex/blob/main/README.md) ;
- [manifest npm/Bun](https://github.com/lidge-jun/opencodex/blob/main/package.json) ;
- [politique de sécurité](https://github.com/lidge-jun/opencodex/blob/main/SECURITY.md) ;
- les PR amont de la chaîne `remote-hub` : [#2771](https://github.com/lidge-jun/opencodex/pull/2771), [#2772](https://github.com/lidge-jun/opencodex/pull/2772), [#2776](https://github.com/lidge-jun/opencodex/pull/2776), [#2777](https://github.com/lidge-jun/opencodex/pull/2777), [#2781](https://github.com/lidge-jun/opencodex/pull/2781), [#2786](https://github.com/lidge-jun/opencodex/pull/2786) et [#2789](https://github.com/lidge-jun/opencodex/pull/2789).

Les éléments des PR sont des travaux non fusionnés : ils ne doivent pas être présentés comme fonctionnalités de `main`, ni servir de dépendance de production sans figer et auditer le commit concerné.

## Faits : produit et architecture actuelle

OpenCodex est un proxy local TypeScript qui traduit l'API **OpenAI Responses** utilisée par Codex vers les protocoles de fournisseurs ; il couvre streaming, tool calls, tokens de raisonnement et images dans les deux sens. Le même service sert Codex CLI/App/SDK, Claude Code, Claude Desktop et Grok Build. Le README annonce plus de 40 connecteurs, dont les fournisseurs natifs et des endpoints compatibles OpenAI. Il fournit également combos (bascule/round-robin) et un pool de comptes ChatGPT avec affinité de thread et routage selon quota. ([README](https://github.com/lidge-jun/opencodex/blob/main/README.md))

Le projet est un module ESM TypeScript. Le code source est exécuté avec Bun ; les scripts `start` et `dev` exécutent `bun run src/cli/index.ts start`. Le paquet npm expose `ocx`/`opencodex`, requiert Node >= 18 et embarque Bun comme dépendance de confiance. Les dépendances directes notables sont le SDK MCP, protobuf, keyring natif, Zod et Bun. ([package.json](https://github.com/lidge-jun/opencodex/blob/main/package.json))

Le service rassemble proxy et tableau de bord, par défaut sur `localhost:10100`. La configuration est gérée depuis le tableau de bord ou la CLI ; `ocx init` écrit `~/.opencodex/config.json` et configure Codex. La CLI expose notamment gestion de providers, comptes, combos, santé, readiness et service. ([README — démarrage et CLI](https://github.com/lidge-jun/opencodex/blob/main/README.md#quick-start))

### Providers, modèles et authentification amont

**Faits.** Les modèles sont adressables sous `provider/model`; sans préfixe, OpenCodex utilise le provider par défaut ou une correspondance de nom. Les providers annoncés incluent OpenAI (login ChatGPT ou clé), Anthropic, Gemini, xAI, Kimi, Azure OpenAI, Ollama, Cursor expérimental et les API compatibles OpenAI, entre autres. Les méthodes mentionnées sont OAuth (xAI, Anthropic, Kimi), clé API, références `${ENV_VAR}`, ou délégation de `codex login`. ([README — routing/providers](https://github.com/lidge-jun/opencodex/blob/main/README.md#model-routing))

**Faits.** Le pool de comptes ChatGPT est une fonction applicative, avec choix par quota et affinité de thread. Le projet avertit explicitement qu'il ne permet pas de contourner les limites, ne garantit aucune protection contre les mesures des fournisseurs, et rappelle la responsabilité de conformité aux CGU. ([README — policy note](https://github.com/lidge-jun/opencodex/blob/main/README.md#highlights))

**Fait de sécurité important.** En écoute loopback, aucune authentification additionnelle n'est requise. Dès qu'il est lié au-delà de loopback (`hostname: 0.0.0.0`), le processus exige une credential data-plane : `OPENCODEX_API_AUTH_TOKEN` ou une entrée `apiKeys` configurée. Les clients utilisent notamment `x-opencodex-api-key`. Le management-plane utilise une credential admin distincte (`OPENCODEX_ADMIN_AUTH_TOKEN` ou fichier durci) et refuse qu'elle soit identique à une clé data-plane. ([README — remote access](https://github.com/lidge-jun/opencodex/blob/main/README.md#remote-access), [configuration serveur](https://github.com/lidge-jun/opencodex/blob/main/docs-site/src/content/docs/reference/configuration/server.md), [Management API](https://github.com/lidge-jun/opencodex/blob/main/docs-site/src/content/docs/reference/management-api.md))

### Protocoles, santé et persistance

**Faits.** La surface data est centrée sur la compatibilité Responses API ; la traduction est conçue pour les flux et appels d'outils. Le README documente `GET /healthz` pour la vivacité et `GET /readyz` non authentifié pour la readiness post-synchronisation. `/readyz` retourne une identité assainie (`service`, `version`, `uptime`, `pid`, `port`, `status`), `200` à l'état ready et `503` (avec `Retry-After: 1`) à pending/failed. `ocx health` et `ocx ready` consomment ces sondes. ([README — health/readiness](https://github.com/lidge-jun/opencodex/blob/main/README.md#health-and-readiness))

**Fait vérifié sur le tag `v2.36.0`.** La release expose déjà `GET|HEAD /v1/catalog` sur le plan de
données. La route accepte la credential data-plane, renvoie le même JSON que le catalogue persisté,
fournit un ETag fort, gère `If-None-Match`/`304`, refuse les écritures et borne la réponse distante à
256 Mio. Cette route stable suffit à synchroniser les modèles d’un client sans lui remettre le token
d’administration. Elle ne fournit pas le pairing, l’émission de clé ni les sessions distantes décrites
par la chaîne `remote-hub`.

**Faits.** La persistance locale comprend au moins `~/.opencodex/config.json`; le README indique aussi des caches et journaux mémoire bornés, sous un budget par défaut de 256 MiB, ainsi qu'une inspection authentifiée via `GET /api/system/memory`. Ce n'est donc pas, dans `main`, une architecture de contrôle central multi-hôtes avec base de données partagée. ([README — mémoire](https://github.com/lidge-jun/opencodex/blob/main/README.md#highlights))

### Installation, exécution et déploiement existants

**Faits.** Installation supportée : `npm install -g @bitkyc08/opencodex`, puis `ocx start`; installation source : Bun, clone, `bun install`, puis `bun run src/cli/index.ts start`. Les systèmes de service annoncés sont launchd, systemd utilisateur et Task Scheduler/WinSW. `ocx service` vise le mode persistant avec redémarrage, alors que le shim démarre à la demande. ([README — installation/service](https://github.com/lidge-jun/opencodex/blob/main/README.md#quick-start))

**Fait / limite.** Le README ne décrit pas d'image Docker officielle, de Helm chart ou de procédure cloud stable pour `main`. La conception publiée est locale et le bind distant n'est qu'une option protégée par un token. Une image Bun et un déploiement Coolify relèvent donc de notre couche d'exploitation, pas d'un chemin amont officiellement documenté.

## Analyse des PR `remote-hub` (état demandé : ouvertes/non fusionnées le 30-08-2026)

| PR | État observé | Ce qu'elle apporte / implique |
| --- | --- | --- |
| [#2771](https://github.com/lidge-jun/opencodex/pull/2771) | Open, documentation seulement | Design et roadmap en six phases : rôles standalone/hub/client, sessions GUI distantes, `ocx connect`, deux plans GUI, déploiement et hardening. Aucun runtime n'est modifié. |
| [#2772](https://github.com/lidge-jun/opencodex/pull/2772) | Open | Phase 1 : `runtimeRole`, négociation protocolaire sur `/readyz`, et `GET /v1/catalog` authentifié data-plane, ETag, limite 32 MiB. |
| [#2776](https://github.com/lidge-jun/opencodex/pull/2776) | Ouverte, chaînée entre phases 1 et 3 | Phase 2 de sessions distantes/pairing dans la pile documentée par #2771; dépendance de la chaîne, non intégrée à `main`. |
| [#2777](https://github.com/lidge-jun/opencodex/pull/2777) | Open | Phase 3 : `ocx connect/disconnect/status/revoke`, contrôle transactionnel, émission automatique d'une clé par client, fichier de token propriétaire et synchronisation client. |
| [#2781](https://github.com/lidge-jun/opencodex/pull/2781) | Draft | Phase 4 : écouteur machine loopback avec allowlist et relais à cible figée; deux plans GUI et usage filtré par clé machine. La revue mainteneur demande de ne pas fusionner cette tête intermédiaire. |
| [#2786](https://github.com/lidge-jun/opencodex/pull/2786) | Open, référencée comme phase 5 | Ingress de management du hub, recettes de déploiement et correctifs de dogfooding; dépend de la phase 4. |
| [#2789](https://github.com/lidge-jun/opencodex/pull/2789) | Draft | Phase 6 : rotation de clés client/management, révocation de sessions, limites de pairing, tests adversariaux (skew protocole, catalog, SSRF/header smuggling du relais) et documentation. |

Les précisions de #2772 et #2777 sont particulièrement pertinentes : la première prévoit une admission data-plane séparée de l'administration et la seconde ne transporte le secret de connexion que via stdin, le stocke dans un fichier propriétaire et promet rollback avant commit. ([#2772](https://github.com/lidge-jun/opencodex/pull/2772), [#2777](https://github.com/lidge-jun/opencodex/pull/2777))

La phase 4 réduit délibérément la surface locale : listener loopback seulement, aucun `/v1/*`, relais vers hub à destination figée, allowlist de chemin, refus de redirect, filtrage hop-by-hop et tailles bornées. Mais elle est Draft et le mainteneur demande rebase/revue sur la tête intégrée finale; ce sont des signaux que ces garanties restent à valider après intégration. ([#2781](https://github.com/lidge-jun/opencodex/pull/2781))

La phase 6 prévoit les bons contrôles de cycle de vie (rotation récupérable, invalidation, rate-limit pairing, tests SSRF/header smuggling), mais reste Draft. Elle ne réduit pas le besoin d'une défense réseau et identité externe au proxy. ([#2789](https://github.com/lidge-jun/opencodex/pull/2789))

## Écart avec le besoin « bastion AI cloud »

**Constat.** `main` répond bien au besoin de traduction de protocoles et de routage de modèles, mais reste conçu d'abord comme proxy local. Le chemin stable sait déjà séparer admin/data et gérer plusieurs clés data-plane révocables ; il ne fournit toutefois pas encore l'enrôlement distant `ocx connect`, le pairing et le cycle de vie machine automatisé de la pile `remote-hub`. Il ne fournit pas non plus de certificats clients ni de stockage de secrets cloud géré.

**Constat.** La chaîne `remote-hub` s'aligne beaucoup mieux sur l'objectif mais elle est encore empilée, non fusionnée et certaines têtes sont Draft. Ne pas bâtir la production sur elle directement; elle peut devenir une source de design et une dépendance candidate après intégration, publication et audit de version.

## Recommandations pour `opencodex-cloud`

1. **Séparer les plans.** Exposer un data-plane unique pour les harnesses; garder dashboard, administration, création/révocation de clés et observabilité sur un management-plane distinct, jamais servi publiquement par défaut.
2. **Éviter le mot de passe statique comme contrôle principal.** Utiliser TLS partout, authentification mTLS par machine (certificat court, identité et révocation), puis une clé data-plane distincte, limitée et rotative par machine. Ne jamais remettre le token admin au navigateur ou à un harness.
3. **Rendre le bypass difficile par réseau.** Proxy sur réseau interne Coolify, seuls 443 du reverse proxy / tunnel privé et le service VPN sont exposés; firewall deny-by-default; aucune publication du port Bun; egress uniquement vers les APIs fournisseurs nécessaires. Une machine cliente rejoint le réseau privé (p. ex. WireGuard/Tailscale) avant mTLS.
4. **Centraliser les secrets hors de l'image.** Références vers un gestionnaire de secrets, compte de runtime non-root en lecture seule, volume de données chiffré et permissions minimales. Ni secrets dans image, git, variables affichées par dashboard, argv ni logs. Prévoir inventaire, rotation et révocation par fournisseur et par machine.
5. **Image Bun minimale et immuable.** Installer directement les versions npm officielles exactes de
   OpenCodex et Codex CLI sur un runtime Bun épinglé par digest. OpenCodex utilise
   `codex debug models --bundled` comme catalogue natif avant de fusionner la découverte provider ;
   une image cloud sans Codex CLI ne peut donc pas matérialiser un catalogue complet. Conserver
   seulement le binaire Codex nécessaire, sans les outils agent/sandbox, puis exécuter en non-root
   avec racine read-only, `tmpfs`, capabilities supprimées, `no-new-privileges`, SBOM et scan CVE.
6. **Sondes et exploitation.** Liveness sur `/healthz`, readiness sur `/readyz` (la sémantique est déjà fournie), avec délais de démarrage réalistes et alertes séparées. Ajouter métriques sans prompts ni secrets, corrélation par machine/clé, rate limits, limites de corps/stream, timeouts, quotas et coupe-circuit par provider.
7. **Adopter les garanties remote-hub seulement après validation.** Si les PR sont fusionnées, consommer une release taggée et tester : autorisation séparée admin/data, pairing, révocation, rotation, résistance SSRF/redirect/header-smuggling, isolation des sessions GUI et retour à l'état offline.

## Risques amont à accepter explicitement

- OpenCodex est indépendant des fournisseurs, et son README prévient que certains peuvent restreindre l'usage via proxy : valider les CGU et les modes OAuth/API avant chaque intégration. ([README — disclaimer](https://github.com/lidge-jun/opencodex/blob/main/README.md#disclaimer))
- Les correctifs de sécurité sont best-effort pour `main` et la dernière release npm seulement; l'amont demande la divulgation privée via GitHub. Épingler une version, surveiller les avis et avoir un processus de mise à jour/rollback. ([SECURITY.md](https://github.com/lidge-jun/opencodex/blob/main/SECURITY.md))
- Ne pas déduire l'absence de défaut de la présence de tests dans les PR : la surface cloud (reverse proxy, certificats, secrets, réseau, Coolify) reste de notre responsabilité d'opérateur.
