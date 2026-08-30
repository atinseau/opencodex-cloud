#!/usr/bin/env bun

import * as p from "@clack/prompts";
import { basename } from "node:path";
import { readFile } from "node:fs/promises";
import { CLIENT_VERSION } from "./constants";
import { resolvePaths } from "./paths";
import { checkServer, syncCatalog } from "./catalog";
import {
  createConnection,
  readConnection,
  readCredential,
  saveConnection,
  saveCredential,
} from "./connection";
import { installCodexConfig } from "./codex-config";
import { installBackgroundSync } from "./service";

function abortIfCancelled<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel("Installation annulée.");
    process.exitCode = 130;
    throw new Error("cancelled");
  }
  return value as T;
}

function executablePath(): string {
  const override = process.env.OPENCODEX_CLOUD_EXECUTABLE?.trim();
  if (override) return override;
  if (basename(process.execPath).startsWith("bun")) {
    throw new Error("L’installation doit être lancée depuis le binaire OpenCodex Cloud publié.");
  }
  return process.execPath;
}

async function connect(): Promise<void> {
  p.intro("OpenCodex Cloud — connecter cette machine");

  if (!Bun.which("codex")) {
    throw new Error("Codex n’est pas installé ou n’est pas accessible dans le PATH.");
  }

  const serverInput = abortIfCancelled(await p.text({
    message: "Adresse du serveur",
    placeholder: "https://ai.example.com",
    validate(value) {
      try {
        createConnection(value || "");
      } catch (error) {
        return error instanceof Error ? error.message : "URL invalide";
      }
    },
  }));
  const apiKey = abortIfCancelled(await p.password({
    message: "Clé API de cette machine",
    mask: "•",
    validate(value) {
      if (!value?.trim()) return "La clé API est obligatoire";
      if (/\s/.test(value)) return "La clé API ne doit contenir aucun espace";
    },
  }));

  const paths = resolvePaths();
  const connection = createConnection(serverInput);
  const self = executablePath();
  const spinner = p.spinner();

  spinner.start("Vérification du serveur");
  let synced: Awaited<ReturnType<typeof syncCatalog>>;
  let service: Awaited<ReturnType<typeof installBackgroundSync>>;
  try {
    await checkServer(connection);
    spinner.message("Téléchargement du catalogue de modèles");
    await saveConnection(paths, connection);
    await saveCredential(paths, apiKey);
    synced = await syncCatalog(paths, connection, apiKey);
    spinner.message("Configuration de Codex");
    await installCodexConfig(paths, connection, self);
    spinner.message("Activation de la synchronisation automatique");
    service = await installBackgroundSync(paths, self);
    spinner.stop("Machine connectée");
  } catch (error) {
    spinner.stop("Connexion impossible");
    throw error;
  }

  p.note([
    synced.models === undefined ? "Catalogue déjà à jour" : `${synced.models} modèles disponibles`,
    `Synchronisation automatique toutes les 30 secondes (${service})`,
    "La clé API est stockée dans un fichier réservé à ton utilisateur",
  ].join("\n"), "Prêt");
  p.outro("Lance simplement codex.");
}

async function sync(quiet: boolean): Promise<void> {
  const paths = resolvePaths();
  const result = await syncCatalog(paths, await readConnection(paths), await readCredential(paths));
  if (!quiet) {
    const message = result.status === "updated"
      ? `Catalogue actualisé (${result.models ?? 0} modèles).`
      : "Catalogue déjà à jour.";
    console.log(message);
  }
}

async function status(): Promise<void> {
  const paths = resolvePaths();
  const connection = await readConnection(paths);
  let state: { lastCheckedAt?: string; lastUpdatedAt?: string } = {};
  try {
    state = JSON.parse(await readFile(paths.stateFile, "utf8")) as typeof state;
  } catch {
    // Report the connection even before a successful sync.
  }
  console.log(JSON.stringify({
    connected: true,
    server: connection.serverUrl,
    catalog: paths.catalogFile,
    lastCheckedAt: state.lastCheckedAt ?? null,
    lastUpdatedAt: state.lastUpdatedAt ?? null,
  }, null, 2));
}

function help(): void {
  console.log(`opencodex-cloud ${CLIENT_VERSION}

Usage:
  opencodex-cloud connect      Connecter cette machine (défaut)
  opencodex-cloud sync         Synchroniser maintenant
  opencodex-cloud status       Afficher l’état local
  opencodex-cloud auth-token   Fournir le token à Codex
  opencodex-cloud --version    Afficher la version
`);
}

async function main(): Promise<void> {
  const command = process.argv[2] || "connect";
  if (command === "connect") return connect();
  if (command === "sync") return sync(process.argv.includes("--quiet"));
  if (command === "status") return status();
  if (command === "auth-token") {
    process.stdout.write(`${await readCredential(resolvePaths())}\n`);
    return;
  }
  if (command === "--version" || command === "-v") {
    console.log(CLIENT_VERSION);
    return;
  }
  if (command === "--help" || command === "-h" || command === "help") return help();
  throw new Error(`Commande inconnue : ${command}`);
}

main().catch((error) => {
  if (error instanceof Error && error.message === "cancelled") return;
  const message = error instanceof Error ? error.message : String(error);
  if (process.stdout.isTTY) p.log.error(message);
  else console.error(`opencodex-cloud: ${message}`);
  process.exitCode = 1;
});
