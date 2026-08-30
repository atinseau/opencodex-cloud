import { readFile, stat } from "node:fs/promises";
import type { ClientPaths } from "./paths";
import type { ConnectionConfig } from "./connection";
import { writePrivateFile } from "./files";
import { MAX_CATALOG_BYTES, REQUEST_TIMEOUT_MS } from "./constants";

interface SyncState {
  etag?: string;
  lastCheckedAt?: string;
  lastUpdatedAt?: string;
}

export interface SyncResult {
  status: "updated" | "unchanged";
  models?: number;
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

async function readState(paths: ClientPaths): Promise<SyncState> {
  try {
    return JSON.parse(await readFile(paths.stateFile, "utf8")) as SyncState;
  } catch {
    return {};
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export function parseCatalogPayload(raw: string): { models: unknown[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Le serveur a renvoyé un catalogue JSON invalide.");
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { models?: unknown }).models)) {
    throw new Error("Le catalogue du serveur ne respecte pas le format Codex attendu.");
  }
  return parsed as { models: unknown[] };
}

export async function readBoundedResponseBody(
  response: Response,
  maximumBytes = MAX_CATALOG_BYTES,
): Promise<string> {
  const announcedLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(announcedLength) && announcedLength > maximumBytes) {
    throw new Error("La réponse du serveur dépasse la limite autorisée.");
  }
  if (!response.body) throw new Error("Le serveur a renvoyé une réponse vide.");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error("La réponse du serveur dépasse la limite autorisée.");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

export interface CatalogProbe {
  models: number;
  etag?: string;
  codexVersion?: string;
}

export async function probeCatalog(
  connection: ConnectionConfig,
  apiKey: string,
  fetcher: FetchLike = fetch,
): Promise<CatalogProbe> {
  const response = await fetcher(connection.catalogUrl, {
    headers: {
      accept: "application/json",
      "x-opencodex-api-key": apiKey,
    },
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("La clé API a été refusée par le serveur.");
  }
  if (response.status === 404) {
    throw new Error("Le serveur n’a pas encore matérialisé son catalogue de modèles.");
  }
  if (!response.ok) throw new Error(`Catalogue distant indisponible : HTTP ${response.status}`);

  const catalog = parseCatalogPayload(await readBoundedResponseBody(response));
  return {
    models: catalog.models.length,
    etag: response.headers.get("etag") || undefined,
    codexVersion: response.headers.get("x-opencodex-codex-version") || undefined,
  };
}

export async function syncCatalog(
  paths: ClientPaths,
  connection: ConnectionConfig,
  apiKey: string,
  fetcher: FetchLike = fetch,
): Promise<SyncResult> {
  const state = await readState(paths);
  const headers = new Headers({
    accept: "application/json",
    "x-opencodex-api-key": apiKey,
  });
  if (state.etag && await fileExists(paths.catalogFile)) headers.set("if-none-match", state.etag);

  let response = await fetcher(connection.catalogUrl, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 304 && !await fileExists(paths.catalogFile)) {
    headers.delete("if-none-match");
    response = await fetcher(connection.catalogUrl, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }
  const checkedAt = new Date().toISOString();

  if (response.status === 304) {
    await writePrivateFile(paths.stateFile, `${JSON.stringify({ ...state, lastCheckedAt: checkedAt }, null, 2)}\n`);
    return { status: "unchanged" };
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error("La clé API a été refusée par le serveur.");
  }
  if (response.status === 404) {
    throw new Error("Le serveur n’a pas encore matérialisé son catalogue de modèles.");
  }
  if (!response.ok) {
    throw new Error(`Synchronisation impossible : HTTP ${response.status}`);
  }

  const raw = await readBoundedResponseBody(response);
  const catalog = parseCatalogPayload(raw);
  await writePrivateFile(paths.catalogFile, `${JSON.stringify(catalog)}\n`);
  await writePrivateFile(paths.stateFile, `${JSON.stringify({
    etag: response.headers.get("etag") || undefined,
    lastCheckedAt: checkedAt,
    lastUpdatedAt: checkedAt,
  }, null, 2)}\n`);
  return { status: "updated", models: catalog.models.length };
}

export async function checkServer(
  connection: ConnectionConfig,
  fetcher: FetchLike = fetch,
): Promise<void> {
  const healthUrl = new URL("/healthz", connection.serverUrl);
  const response = await fetcher(healthUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Serveur indisponible : HTTP ${response.status}`);
}
