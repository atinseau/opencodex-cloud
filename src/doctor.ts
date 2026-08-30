import { access, readFile, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import type { ClientPaths } from "./paths";
import {
  readConnection,
  readCredential,
  type ConnectionConfig,
} from "./connection";
import {
  probeCatalog,
  readBoundedResponseBody,
  type FetchLike,
} from "./catalog";
import { inspectBackgroundSync } from "./service";
import { PROVIDER_ID, REQUEST_TIMEOUT_MS, SYNC_INTERVAL_SECONDS } from "./constants";

export type DoctorStatus = "pass" | "warn" | "fail" | "skip";

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  detail: string;
}

export interface DoctorReport {
  ok: boolean;
  server?: string;
  checkedAt: string;
  checks: DoctorCheck[];
}

export interface DoctorDependencies {
  fetcher: FetchLike;
  findCodex: () => string | null;
  inspectService: () => Promise<string>;
  now: () => Date;
}

const defaultDependencies: DoctorDependencies = {
  fetcher: fetch,
  findCodex: () => Bun.which("codex"),
  inspectService: () => inspectBackgroundSync(),
  now: () => new Date(),
};

type CheckResult = Omit<DoctorCheck, "id" | "label">;

function pass(detail: string): CheckResult {
  return { status: "pass", detail };
}

function warn(detail: string): CheckResult {
  return { status: "warn", detail };
}

function fail(error: unknown): CheckResult {
  return { status: "fail", detail: error instanceof Error ? error.message : String(error) };
}

async function runCheck(
  checks: DoctorCheck[],
  id: string,
  label: string,
  check: () => Promise<CheckResult>,
): Promise<CheckResult> {
  let result: CheckResult;
  try {
    result = await check();
  } catch (error) {
    result = fail(error);
  }
  checks.push({ id, label, ...result });
  return result;
}

function skipped(checks: DoctorCheck[], id: string, label: string, detail: string): void {
  checks.push({ id, label, status: "skip", detail });
}

async function checkCodexConfig(paths: ClientPaths, connection: ConnectionConfig): Promise<CheckResult> {
  const source = await readFile(paths.codexConfigFile, "utf8");
  const required = [
    `model_provider = ${JSON.stringify(PROVIDER_ID)}`,
    `model_catalog_json = ${JSON.stringify(paths.catalogFile)}`,
    `[model_providers.${PROVIDER_ID}]`,
    `base_url = ${JSON.stringify(new URL("/v1", connection.serverUrl).toString().replace(/\/$/, ""))}`,
    `[model_providers.${PROVIDER_ID}.auth]`,
    `args = ["auth-token"]`,
  ];
  const missing = required.filter((line) => !source.includes(line));
  if (missing.length) throw new Error(`configuration gérée incomplète (${missing[0]})`);

  const authSection = source.match(new RegExp(
    `\\[model_providers\\.${PROVIDER_ID}\\.auth](?<body>[\\s\\S]*?)(?:\\n\\[|$)`,
  ))?.groups?.body;
  const commandValue = authSection?.match(/^\s*command\s*=\s*("(?:[^"\\]|\\.)*")\s*$/m)?.[1];
  if (!commandValue) throw new Error("commande d’authentification Codex absente");
  const command = JSON.parse(commandValue) as string;
  await access(command, fsConstants.X_OK);
  return pass("provider, catalogue et authentification command-backed configurés");
}

async function checkLocalCatalog(paths: ClientPaths): Promise<CheckResult> {
  const parsed = JSON.parse(await readFile(paths.catalogFile, "utf8")) as { models?: unknown };
  if (!Array.isArray(parsed.models)) throw new Error("catalogue local invalide");
  const metadata = await stat(paths.catalogFile);
  if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
    throw new Error("permissions du catalogue trop larges");
  }
  return parsed.models.length > 0
    ? pass(`${parsed.models.length} modèles en cache local`)
    : warn("catalogue local valide mais vide");
}

async function checkSyncFreshness(paths: ClientPaths, now: Date): Promise<CheckResult> {
  const state = JSON.parse(await readFile(paths.stateFile, "utf8")) as { lastCheckedAt?: unknown };
  if (typeof state.lastCheckedAt !== "string") return warn("aucune synchronisation datée");
  const checkedAt = Date.parse(state.lastCheckedAt);
  if (!Number.isFinite(checkedAt)) return warn("date de synchronisation invalide");
  const ageSeconds = Math.max(0, Math.round((now.getTime() - checkedAt) / 1000));
  const staleAfter = SYNC_INTERVAL_SECONDS * 4;
  return ageSeconds <= staleAfter
    ? pass(`dernière vérification il y a ${ageSeconds}s`)
    : warn(`dernière vérification il y a ${ageSeconds}s (attendu < ${staleAfter}s)`);
}

async function requestJson(
  connection: ConnectionConfig,
  path: string,
  fetcher: FetchLike,
  headers?: HeadersInit,
): Promise<{ response: Response; body: unknown }> {
  const response = await fetcher(new URL(path, connection.serverUrl), {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const raw = await readBoundedResponseBody(response, 1024 * 1024);
  let body: unknown = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    if (response.ok) throw new Error(`${path} a renvoyé un JSON invalide`);
    body = raw;
  }
  return { response, body };
}

export async function diagnose(
  paths: ClientPaths,
  dependencies: DoctorDependencies = defaultDependencies,
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const codex = dependencies.findCodex();
  checks.push(codex
    ? { id: "codex", label: "Codex installé", status: "pass", detail: codex }
    : { id: "codex", label: "Codex installé", status: "fail", detail: "commande codex introuvable" });

  let connection: ConnectionConfig | undefined;
  const connectionResult = await runCheck(checks, "connection", "Configuration cliente", async () => {
    connection = await readConnection(paths);
    return connection.serverUrl.startsWith("https:")
      ? pass(connection.serverUrl)
      : warn(`${connection.serverUrl} (HTTP loopback uniquement)`);
  });

  let apiKey: string | undefined;
  const credentialResult = await runCheck(checks, "credential", "Clé API locale", async () => {
    apiKey = await readCredential(paths);
    return pass("présente, non vide et permissions privées");
  });

  if (connection) {
    await runCheck(checks, "codex-config", "Configuration Codex", () => checkCodexConfig(paths, connection!));
  } else {
    skipped(checks, "codex-config", "Configuration Codex", "configuration cliente indisponible");
  }
  await runCheck(checks, "local-catalog", "Catalogue local", () => checkLocalCatalog(paths));
  await runCheck(checks, "sync-service", "Synchronisation automatique", async () => pass(await dependencies.inspectService()));
  await runCheck(checks, "sync-freshness", "Fraîcheur du catalogue", () => checkSyncFreshness(paths, dependencies.now()));

  if (connectionResult.status === "fail" || !connection) {
    for (const [id, label] of [
      ["proxy-health", "Proxy /healthz"],
      ["proxy-readiness", "Proxy /readyz"],
      ["remote-catalog", "Authentification et catalogue distant"],
      ["models-api", "Connexion Codex /v1/models"],
    ] as const) skipped(checks, id, label, "configuration cliente indisponible");
  } else {
    await runCheck(checks, "proxy-health", "Proxy /healthz", async () => {
      const { response, body } = await requestJson(connection!, "/healthz", dependencies.fetcher);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const service = typeof body === "object" && body && "service" in body
        ? String((body as { service: unknown }).service)
        : "unknown";
      if (service !== "opencodex") throw new Error(`service inattendu : ${service}`);
      return pass(`HTTP ${response.status}, service opencodex`);
    });

    await runCheck(checks, "proxy-readiness", "Proxy /readyz", async () => {
      const { response, body } = await requestJson(connection!, "/readyz", dependencies.fetcher);
      const status = typeof body === "object" && body && "status" in body
        ? String((body as { status: unknown }).status)
        : "unknown";
      const service = typeof body === "object" && body && "service" in body
        ? String((body as { service: unknown }).service)
        : "unknown";
      if (!response.ok || status !== "ready" || service !== "opencodex") {
        throw new Error(`HTTP ${response.status}, service ${service}, état ${status}`);
      }
      return pass(`HTTP ${response.status}, service opencodex, état ready`);
    });

    if (credentialResult.status === "fail" || !apiKey) {
      skipped(checks, "remote-catalog", "Authentification et catalogue distant", "clé API indisponible");
      skipped(checks, "models-api", "Connexion Codex /v1/models", "clé API indisponible");
    } else {
      await runCheck(checks, "remote-catalog", "Authentification et catalogue distant", async () => {
        const catalog = await probeCatalog(connection!, apiKey!, dependencies.fetcher);
        return catalog.models > 0
          ? pass(`${catalog.models} modèles, clé data-plane acceptée${catalog.codexVersion ? `, Codex ${catalog.codexVersion}` : ""}`)
          : warn("clé acceptée, mais catalogue distant vide");
      });

      await runCheck(checks, "models-api", "Connexion Codex /v1/models", async () => {
        const { response, body } = await requestJson(connection!, "/v1/models", dependencies.fetcher, {
          accept: "application/json",
          authorization: `Bearer ${apiKey}`,
        });
        if (response.status === 401 || response.status === 403) throw new Error("bearer Codex refusé");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const models = typeof body === "object" && body && Array.isArray((body as { data?: unknown }).data)
          ? (body as { data: unknown[] }).data.length
          : null;
        if (models === null) throw new Error("réponse /v1/models invalide");
        return models > 0 ? pass(`HTTP ${response.status}, ${models} modèles`) : warn("endpoint accessible mais liste vide");
      });
    }
  }

  return {
    ok: checks.every((check) => check.status !== "fail"),
    server: connection?.serverUrl,
    checkedAt: dependencies.now().toISOString(),
    checks,
  };
}
