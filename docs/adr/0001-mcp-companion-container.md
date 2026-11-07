# ADR 0001 : le connecteur Claude tourne dans un conteneur dédié

Statut : accepté, novembre 2026.

## Contexte

Le connecteur MCP doit joindre la génération d'image du hub OpenCodex et être publié en HTTPS pour
Claude. Il vit dans ce dépôt, à côté de l'image du hub.

## Décision

Le connecteur est un workspace (`packages/mcp`) avec sa propre image, déployée comme seconde
application Coolify dans le même projet. Il appelle le hub par le réseau Docker privé avec une clé de
plan de données dédiée.

## Conséquences

- Le hub reste l'image OpenCodex amont, avec un seul processus et sans superviseur maison.
- Un déploiement du connecteur ne redémarre pas le hub. Le hub exige un remplacement séquentiel du
  conteneur, avec une courte interruption, à cause du verrou sur son journal de dépenses.
- Une faille dans le connecteur n'expose ni le volume du hub, ni les jetons des comptes, ni le plan
  d'administration.
- Il faut gérer deux applications Coolify, deux domaines et une clé de plus.
