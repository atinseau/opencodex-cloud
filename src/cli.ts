#!/usr/bin/env bun

import * as p from "@clack/prompts";
import { basename } from "node:path";
import { readFile } from "node:fs/promises";
import { CLIENT_VERSION } from "./constants";
import { resolvePaths } from "./paths";
import { checkServer, syncCatalog } from "./catalog";
import {
  createConnection,
  isLoopbackServerUrl,
  readConnection,
  readCredential,
  saveConnection,
  saveCredential,
} from "./connection";
import {
  beginCloudRoutingSwitch,
  inspectCodexRoutingFile,
  readRoutingState,
  restorePreviousCodexRouting,
} from "./codex-config";
import { installCodexConfig } from "./codex-config";
import { installBackgroundSync, uninstallBackgroundSync } from "./service";
import { diagnose, type DoctorReport } from "./doctor";
import { probeLocalOpenCodex } from "./local-proxy";

function abortIfCancelled<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel("Opération annulée.");
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

  const paths = resolvePaths();
  const currentRouting = await inspectCodexRoutingFile(paths);
  const localProxy = await probeLocalOpenCodex(currentRouting.localEndpoint ?? (
    currentRouting.mode === "opencodex-local" ? currentRouting.endpoint : undefined
  ));
  const takesControl = currentRouting.mode !== "cloud" && (
    currentRouting.mode !== "native"
    || Boolean(currentRouting.provider)
    || Boolean(currentRouting.catalog)
    || localProxy.running
  );

  if (takesControl) {
    const details = [
      `Routage actuel : ${currentRouting.mode === "opencodex-local" ? "OpenCodex local" : currentRouting.mode}`,
      currentRouting.provider ? `Provider actif : ${currentRouting.provider}` : undefined,
      currentRouting.catalog ? `Catalogue actif : ${currentRouting.catalog}` : undefined,
      localProxy.running ? `Proxy OpenCodex local détecté : ${localProxy.endpoint}` : undefined,
      "OpenCodex Cloud remplacera temporairement le provider et le catalogue racine.",
      "La commande `opencodex-cloud disconnect` restaurera ces deux réglages sans toucher au reste.",
    ].filter(Boolean).join("\n");
    p.note(details, "Basculement de Codex");
    const confirmed = abortIfCancelled(await p.confirm({
      message: "Donner la main à OpenCodex Cloud ?",
      initialValue: false,
    }));
    if (!confirmed) {
      p.cancel("Configuration Codex conservée.");
      return;
    }
  }

  const serverInput = abortIfCancelled(await p.text({
    message: "Adresse du serveur",
    placeholder: "https://ai.example.com",
    validate(value) {
      try {
        const candidate = createConnection(value || "");
        if (isLoopbackServerUrl(candidate.serverUrl) && process.env.OPENCODEX_CLOUD_ALLOW_LOOPBACK !== "1") {
          return "Le serveur Cloud ne peut pas être localhost";
        }
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

  const connection = createConnection(serverInput);
  if (isLoopbackServerUrl(connection.serverUrl) && process.env.OPENCODEX_CLOUD_ALLOW_LOOPBACK !== "1") {
    throw new Error("Le serveur OpenCodex Cloud doit être distant. localhost est réservé au développement explicite.");
  }
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
    await beginCloudRoutingSwitch(paths);
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

async function disconnect(): Promise<void> {
  const paths = resolvePaths();
  const current = await inspectCodexRoutingFile(paths);
  const state = await readRoutingState(paths);
  if (current.mode !== "cloud" && !current.cloudManaged && !state) {
    p.intro("OpenCodex Cloud — déconnecter cette machine");
    p.outro("OpenCodex Cloud n’a pas la main sur Codex.");
    return;
  }

  p.intro("OpenCodex Cloud — déconnecter cette machine");
  const confirmed = abortIfCancelled(await p.confirm({
    message: "Restaurer le routage Codex précédent et arrêter la synchronisation Cloud ?",
    initialValue: true,
  }));
  if (!confirmed) {
    p.cancel("Déconnexion annulée.");
    return;
  }

  const spinner = p.spinner();
  spinner.start("Arrêt de la synchronisation automatique");
  try {
    await uninstallBackgroundSync(paths);
    spinner.message("Restauration du routage Codex précédent");
    const restored = await restorePreviousCodexRouting(paths);
    const local = await probeLocalOpenCodex(restored.localEndpoint ?? (
      restored.mode === "opencodex-local" ? restored.endpoint : undefined
    ));
    spinner.stop("OpenCodex Cloud déconnecté");
    p.note([
      `Routage restauré : ${restored.mode === "opencodex-local" ? "OpenCodex local" : restored.mode}`,
      restored.provider ? `Provider actif : ${restored.provider}` : "Provider Codex natif",
      local.running ? `Proxy local joignable : ${local.endpoint}` : "Aucun proxy OpenCodex local joignable",
      "La configuration Cloud et sa clé restent stockées pour une reconnexion ultérieure.",
    ].join("\n"), "Restauration terminée");
    p.outro("Lance simplement codex.");
  } catch (error) {
    spinner.stop("Déconnexion incomplète");
    throw error;
  }
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
  const routing = await inspectCodexRoutingFile(paths);
  let state: { lastCheckedAt?: string; lastUpdatedAt?: string } = {};
  try {
    state = JSON.parse(await readFile(paths.stateFile, "utf8")) as typeof state;
  } catch {
    // Report the connection even before a successful sync.
  }
  console.log(JSON.stringify({
    connected: routing.mode === "cloud",
    mode: routing.mode,
    server: connection.serverUrl,
    catalog: paths.catalogFile,
    lastCheckedAt: state.lastCheckedAt ?? null,
    lastUpdatedAt: state.lastUpdatedAt ?? null,
  }, null, 2));
}

function renderDoctor(report: DoctorReport): void {
  p.intro("OpenCodex Cloud — doctor");
  for (const check of report.checks) {
    const message = `${check.label} — ${check.detail}`;
    if (check.status === "pass") p.log.success(message);
    else if (check.status === "warn") p.log.warn(message);
    else if (check.status === "fail") p.log.error(message);
    else p.log.info(`${check.label} — non testé (${check.detail})`);
  }

  const failures = report.checks.filter((check) => check.status === "fail").length;
  const warnings = report.checks.filter((check) => check.status === "warn").length;
  if (failures === 0) {
    p.outro(warnings === 0
      ? "Tout fonctionne. La machine peut utiliser codex."
      : `Connexion fonctionnelle avec ${warnings} avertissement(s).`);
  } else {
    p.outro(`${failures} contrôle(s) en échec.`);
  }
}

async function doctor(json: boolean): Promise<void> {
  const report = await diagnose(resolvePaths());
  if (json) console.log(JSON.stringify(report, null, 2));
  else renderDoctor(report);
  if (!report.ok) process.exitCode = 1;
}

function help(): void {
  console.log(`opencodex-cloud ${CLIENT_VERSION}

Usage:
  opencodex-cloud connect      Connecter cette machine (défaut)
  opencodex-cloud disconnect   Restaurer le routage Codex précédent
  opencodex-cloud sync         Synchroniser maintenant
  opencodex-cloud status       Afficher l’état local
  opencodex-cloud doctor       Vérifier toute la connexion client → proxy
  opencodex-cloud auth-token   Fournir le token à Codex
  opencodex-cloud --version    Afficher la version
`);
}

async function main(): Promise<void> {
  const command = process.argv[2] || "connect";
  if (command === "connect") return connect();
  if (command === "disconnect") return disconnect();
  if (command === "sync") return sync(process.argv.includes("--quiet"));
  if (command === "status") return status();
  if (command === "doctor") return doctor(process.argv.includes("--json"));
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
