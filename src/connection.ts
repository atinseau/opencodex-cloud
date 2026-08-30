import { readFile, stat } from "node:fs/promises";
import type { ClientPaths } from "./paths";
import { writePrivateFile } from "./files";

export interface ConnectionConfig {
  serverUrl: string;
  catalogUrl: string;
  installedAt: string;
}

export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("URL invalide");
  }

  const isLoopback = url.hostname === "localhost"
    || url.hostname === "127.0.0.1"
    || url.hostname === "[::1]"
    || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new Error("HTTPS est obligatoire hors localhost");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Utilise uniquement l’origine du serveur, sans identifiants, paramètres ni fragment");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error("Utilise uniquement l’origine du serveur, par exemple https://ai.example.com");
  }

  return url.origin;
}

export function createConnection(serverUrl: string): ConnectionConfig {
  const normalized = normalizeServerUrl(serverUrl);
  return {
    serverUrl: normalized,
    catalogUrl: new URL("/v1/catalog", normalized).toString(),
    installedAt: new Date().toISOString(),
  };
}

export async function saveConnection(paths: ClientPaths, connection: ConnectionConfig): Promise<void> {
  await writePrivateFile(paths.connectionFile, `${JSON.stringify(connection, null, 2)}\n`);
}

export async function readConnection(paths: ClientPaths): Promise<ConnectionConfig> {
  let raw: string;
  try {
    raw = await readFile(paths.connectionFile, "utf8");
  } catch {
    throw new Error("Cette machine n’est pas connectée. Relance l’installateur.");
  }
  const parsed = JSON.parse(raw) as Partial<ConnectionConfig>;
  if (typeof parsed.serverUrl !== "string") {
    throw new Error("La configuration OpenCodex Cloud locale est invalide.");
  }
  const normalized = createConnection(parsed.serverUrl);
  return {
    ...normalized,
    installedAt: typeof parsed.installedAt === "string" ? parsed.installedAt : normalized.installedAt,
  };
}

export async function saveCredential(paths: ClientPaths, apiKey: string): Promise<void> {
  const value = apiKey.trim();
  if (!value || /[\r\n]/.test(value)) throw new Error("Clé API invalide");
  await writePrivateFile(paths.credentialFile, `${value}\n`);
}

export async function readCredential(paths: ClientPaths): Promise<string> {
  try {
    const metadata = await stat(paths.credentialFile);
    if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
      throw new Error("credential permissions are too broad");
    }
    const value = (await readFile(paths.credentialFile, "utf8")).trim();
    if (!value || /[\r\n]/.test(value)) throw new Error("invalid credential");
    return value;
  } catch {
    throw new Error("Clé API OpenCodex Cloud introuvable ou invalide.");
  }
}
