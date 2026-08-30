# Modèle de sécurité

## Barrières obligatoires

1. Coolify termine TLS avec un certificat valide. Aucun accès HTTP public n'est autorisé.
2. Le conteneur n'expose aucun port sur l'hôte. Seul le réseau proxy de Coolify peut joindre `10100`.
3. `OPENCODEX_API_AUTH_TOKEN` protège le trafic modèle et `OPENCODEX_ADMIN_AUTH_TOKEN` protège le
   dashboard et `/api/*`. L'entrypoint refuse les secrets absents, trop courts ou identiques.
4. Une clé par machine est créée ensuite dans le dashboard pour permettre révocation et attribution.
5. Le volume, ses snapshots et les sauvegardes doivent être chiffrés. Les jetons OAuth sont des
   secrets récupérables depuis les fichiers par un administrateur de l'hôte.

## Durcissement du conteneur

- utilisateur non privilégié `bun` ;
- toutes les capabilities Linux supprimées ;
- `no-new-privileges` ;
- racine en lecture seule et `/tmp` éphémère avec `noexec,nosuid,nodev` ;
- volume dédié en écriture ;
- nombre de processus borné ;
- logs Docker rotatifs ;
- source upstream et runtime épinglés ;
- images de base et frontend Docker épinglés par digest SHA-256 ;
- dépendances de production seulement, scripts d'installation désactivés ;
- aucun socket Docker monté.

## Accès réseau recommandé

La clé OpenCodex sur HTTPS est le minimum. Pour un bastion réellement privé, ajouter une barrière
réseau indépendante : Tailscale/WireGuard ou Cloudflare Access avec identité d'entreprise. Le meilleur
profil est de ne publier le domaine que sur le réseau privé. Un mot de passe HTTP devant tout le
domaine peut casser les clients API ; si une seconde authentification est souhaitée, elle doit viser
uniquement le dashboard et `/api/*`, ou être appliquée par un réseau privé transparent aux clients.

Le mTLS est excellent, mais doit être terminé par le composant qui voit le certificat client. Avec
le TLS standard de Coolify, le certificat est déjà terminé par Traefik ; ajouter du mTLS dans le
conteneur demanderait du TLS passthrough ou un listener dédié. Tailscale + clés OpenCodex offre une
barrière équivalente plus simple à exploiter sur plusieurs machines.

## Points restant à auditer

- politiques réseau et ports effectivement ouverts sur l'hôte Coolify ;
- version et correctifs de Coolify, Docker et du noyau ;
- configuration SSH, pare-feu et fail2ban ;
- accès au dashboard Coolify et MFA ;
- permissions des volumes et chiffrement des sauvegardes ;
- domaines, certificats, headers proxy et limites de débit ;
- exposition de `/api/*`, `/healthz` et `/readyz` ;
- rotation et révocation des secrets ;
- vulnérabilités CVE de l'image construite.
