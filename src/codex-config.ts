import { chmod, copyFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import type { ClientPaths } from "./paths";
import type { ConnectionConfig } from "./connection";
import { PROVIDER_ID } from "./constants";
import { writePrivateFile } from "./files";

const MANAGED_ROOT_START = "# >>> opencodex-cloud root";
const MANAGED_ROOT_END = "# <<< opencodex-cloud root";
const MANAGED_PROVIDER_START = "# >>> opencodex-cloud provider";
const MANAGED_PROVIDER_END = "# <<< opencodex-cloud provider";
const ROUTING_STATE_VERSION = 1;

export type CodexRoutingMode = "cloud" | "opencodex-local" | "custom" | "native";

export interface CodexRoutingInfo {
  mode: CodexRoutingMode;
  provider?: string;
  catalog?: string;
  endpoint?: string;
  localEndpoint?: string;
  cloudManaged: boolean;
}

interface CodexRoutingSnapshot {
  modelProviderLine: string | null;
  modelCatalogLine: string | null;
  cloudProviderTables: string | null;
}

export interface CodexRoutingState {
  version: 1;
  capturedAt: string;
  previous: CodexRoutingSnapshot;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function removeManagedBlock(source: string, start: string, end: string): string {
  const pattern = new RegExp(`(?:^|\\n)${escapeRegExp(start)}\\n[\\s\\S]*?\\n${escapeRegExp(end)}(?:\\n|$)`, "g");
  return source.replace(pattern, "\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeRootKey(source: string, key: string): string {
  const lines = source.split("\n");
  let insideRoot = true;
  return lines.filter((line) => {
    if (/^\s*\[/.test(line)) insideRoot = false;
    return !(insideRoot && new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`).test(line));
  }).join("\n");
}

function removeProviderTables(source: string): string {
  const prefix = `model_providers.${PROVIDER_ID}`;
  let skip = false;
  return source.split("\n").filter((line) => {
    const header = line.match(/^\s*\[([^\]]+)]\s*(?:#.*)?$/);
    if (header) {
      const name = header[1]?.trim();
      skip = name === prefix || name?.startsWith(`${prefix}.`) === true;
    }
    return !skip;
  }).join("\n");
}

function rootAssignmentLine(source: string, key: string): string | null {
  const firstTable = source.search(/^\s*\[/m);
  const root = firstTable === -1 ? source : source.slice(0, firstTable);
  return root.split("\n").find((line) => new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`).test(line)) ?? null;
}

function parseTomlStringAssignment(line: string | null): string | undefined {
  if (!line) return undefined;
  const value = line.slice(line.indexOf("=") + 1).trim();
  if (value.startsWith('"')) {
    try {
      const literal = value.match(/^"(?:[^"\\]|\\.)*"/)?.[0];
      if (!literal) return undefined;
      const parsed = JSON.parse(literal) as unknown;
      return typeof parsed === "string" ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  const literal = value.match(/^'([^']*)'/)?.[1];
  if (literal !== undefined) return literal;
  return undefined;
}

function providerTables(source: string, providerId: string): string | null {
  const prefix = `model_providers.${providerId}`;
  const lines = source.split("\n");
  const selected: string[] = [];
  let collecting = false;
  for (const line of lines) {
    const header = line.match(/^\s*\[([^\]]+)]\s*(?:#.*)?$/);
    if (header) {
      const name = header[1]?.trim();
      collecting = name === prefix || name?.startsWith(`${prefix}.`) === true;
    }
    if (collecting) selected.push(line);
  }
  const value = selected.join("\n").trim();
  return value || null;
}

function providerValue(source: string, providerId: string, key: string): string | undefined {
  const table = providerTables(source, providerId);
  if (!table) return undefined;
  const lines = table.split("\n");
  const firstHeader = lines.findIndex((line) => /^\s*\[/.test(line));
  for (let index = firstHeader + 1; index < lines.length; index++) {
    const line = lines[index];
    if (line === undefined || /^\s*\[/.test(line)) break;
    if (new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`).test(line)) {
      return parseTomlStringAssignment(line);
    }
  }
  return undefined;
}

function isLoopbackEndpoint(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
  } catch {
    return false;
  }
}

export function inspectCodexRouting(source: string): CodexRoutingInfo {
  const provider = parseTomlStringAssignment(rootAssignmentLine(source, "model_provider"));
  const catalog = parseTomlStringAssignment(rootAssignmentLine(source, "model_catalog_json"));
  const cloudEndpoint = providerValue(source, PROVIDER_ID, "base_url");
  const openAiOverride = parseTomlStringAssignment(rootAssignmentLine(source, "openai_base_url"));
  const activeProviderEndpoint = provider ? providerValue(source, provider, "base_url") : undefined;
  const localEndpoint = [openAiOverride, activeProviderEndpoint, providerValue(source, "opencodex", "base_url")]
    .find(isLoopbackEndpoint);
  const cloudManaged = source.includes(MANAGED_ROOT_START) || source.includes(MANAGED_PROVIDER_START);

  if (provider === PROVIDER_ID && cloudEndpoint) {
    return { mode: "cloud", provider, catalog, endpoint: cloudEndpoint, localEndpoint, cloudManaged };
  }
  if (localEndpoint) {
    return { mode: "opencodex-local", provider, catalog, endpoint: localEndpoint, cloudManaged };
  }
  if (!provider || provider === "openai") {
    return { mode: "native", provider, catalog, cloudManaged };
  }
  return { mode: "custom", provider, catalog, endpoint: activeProviderEndpoint, cloudManaged };
}

export async function inspectCodexRoutingFile(paths: ClientPaths): Promise<CodexRoutingInfo> {
  try {
    return inspectCodexRouting(await readFile(paths.codexConfigFile, "utf8"));
  } catch {
    return inspectCodexRouting("");
  }
}

function captureRouting(source: string): CodexRoutingSnapshot {
  return {
    modelProviderLine: rootAssignmentLine(source, "model_provider"),
    modelCatalogLine: rootAssignmentLine(source, "model_catalog_json"),
    cloudProviderTables: providerTables(source, PROVIDER_ID),
  };
}

function validateSnapshot(snapshot: CodexRoutingSnapshot): CodexRoutingSnapshot {
  for (const [key, line] of [
    ["model_provider", snapshot.modelProviderLine],
    ["model_catalog_json", snapshot.modelCatalogLine],
  ] as const) {
    if (line !== null && (line.includes("\n") || !new RegExp(`^\\s*${key}\\s*=`).test(line))) {
      throw new Error("État de restauration Codex invalide.");
    }
  }
  if (snapshot.cloudProviderTables) {
    const headers = [...snapshot.cloudProviderTables.matchAll(/^\s*\[([^\]]+)]/gm)]
      .map((match) => match[1]?.trim());
    const prefix = `model_providers.${PROVIDER_ID}`;
    if (headers.length === 0 || headers.some((header) => header !== prefix && !header?.startsWith(`${prefix}.`))) {
      throw new Error("État de restauration Codex invalide.");
    }
  }
  return snapshot;
}

export async function readRoutingState(paths: ClientPaths): Promise<CodexRoutingState | null> {
  try {
    const parsed = JSON.parse(await readFile(paths.routingStateFile, "utf8")) as Partial<CodexRoutingState>;
    if (parsed.version !== ROUTING_STATE_VERSION || typeof parsed.capturedAt !== "string" || !parsed.previous) {
      throw new Error("État de restauration Codex invalide.");
    }
    return { version: 1, capturedAt: parsed.capturedAt, previous: validateSnapshot(parsed.previous) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function beginCloudRoutingSwitch(paths: ClientPaths): Promise<CodexRoutingState> {
  let current = "";
  try {
    current = await readFile(paths.codexConfigFile, "utf8");
  } catch {
    // A first Codex installation legitimately has no config yet.
  }

  const currentRouting = inspectCodexRouting(current);
  const existing = await readRoutingState(paths);
  if (existing && currentRouting.mode === "cloud") return existing;

  let snapshotSource = current;
  if (currentRouting.mode === "cloud") {
    try {
      snapshotSource = await readFile(paths.codexConfigBackupFile, "utf8");
    } catch {
      snapshotSource = removeRootKey(removeRootKey(
        removeProviderTables(removeManagedBlock(removeManagedBlock(
          current,
          MANAGED_ROOT_START,
          MANAGED_ROOT_END,
        ), MANAGED_PROVIDER_START, MANAGED_PROVIDER_END)),
        "model_provider",
      ), "model_catalog_json");
    }
  }

  const state: CodexRoutingState = {
    version: 1,
    capturedAt: new Date().toISOString(),
    previous: captureRouting(snapshotSource),
  };
  await writePrivateFile(paths.routingStateFile, `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

export function renderDisconnectedCodexConfig(current: string, state: CodexRoutingState): string {
  let cleaned = removeManagedBlock(current, MANAGED_ROOT_START, MANAGED_ROOT_END);
  cleaned = removeManagedBlock(cleaned, MANAGED_PROVIDER_START, MANAGED_PROVIDER_END);
  cleaned = removeProviderTables(cleaned);
  cleaned = removeRootKey(cleaned, "model_provider");
  cleaned = removeRootKey(cleaned, "model_catalog_json");
  cleaned = cleaned.replace(/^\s+/, "").replace(/\s+$/, "");

  const restoredRoot = [state.previous.modelProviderLine, state.previous.modelCatalogLine]
    .filter((line): line is string => Boolean(line))
    .join("\n");
  const firstTable = cleaned.search(/^\s*\[/m);
  const root = firstTable === -1 ? cleaned : cleaned.slice(0, firstTable).trimEnd();
  const tables = firstTable === -1 ? "" : cleaned.slice(firstTable).trim();
  return [root, restoredRoot, tables, state.previous.cloudProviderTables]
    .filter(Boolean)
    .join("\n\n")
    .replace(/^\s+/, "") + "\n";
}

export async function restorePreviousCodexRouting(paths: ClientPaths): Promise<CodexRoutingInfo> {
  let current = "";
  try {
    current = await readFile(paths.codexConfigFile, "utf8");
  } catch {
    // Restore into a new config if the file disappeared while Cloud was active.
  }

  let state = await readRoutingState(paths);
  if (!state) {
    let backup = "";
    try {
      backup = await readFile(paths.codexConfigBackupFile, "utf8");
    } catch {
      // Legacy installs without a pre-existing config have nothing to restore.
    }
    state = {
      version: 1,
      capturedAt: new Date().toISOString(),
      previous: captureRouting(backup),
    };
  }

  const restored = renderDisconnectedCodexConfig(current, state);
  await writePrivateFile(paths.codexConfigFile, restored);
  await rm(paths.routingStateFile, { force: true });
  return inspectCodexRouting(restored);
}

export function renderCodexConfig(
  current: string,
  paths: ClientPaths,
  connection: ConnectionConfig,
  executablePath: string,
): string {
  let cleaned = removeManagedBlock(current, MANAGED_ROOT_START, MANAGED_ROOT_END);
  cleaned = removeManagedBlock(cleaned, MANAGED_PROVIDER_START, MANAGED_PROVIDER_END);
  cleaned = removeProviderTables(cleaned);
  cleaned = removeRootKey(cleaned, "model_provider");
  cleaned = removeRootKey(cleaned, "model_catalog_json");
  cleaned = cleaned.replace(/^\s+/, "").replace(/\s+$/, "");

  const rootBlock = [
    MANAGED_ROOT_START,
    `model_provider = ${tomlString(PROVIDER_ID)}`,
    `model_catalog_json = ${tomlString(paths.catalogFile)}`,
    MANAGED_ROOT_END,
  ].join("\n");

  const firstTable = cleaned.search(/^\s*\[/m);
  const root = firstTable === -1 ? cleaned : cleaned.slice(0, firstTable).trimEnd();
  const tables = firstTable === -1 ? "" : cleaned.slice(firstTable).trim();
  const providerBlock = [
    MANAGED_PROVIDER_START,
    `[model_providers.${PROVIDER_ID}]`,
    `name = "OpenCodex Cloud"`,
    `base_url = ${tomlString(new URL("/v1", connection.serverUrl).toString().replace(/\/$/, ""))}`,
    `wire_api = "responses"`,
    "",
    `[model_providers.${PROVIDER_ID}.auth]`,
    `command = ${tomlString(executablePath)}`,
    `args = ["auth-token"]`,
    "timeout_ms = 5000",
    "refresh_interval_ms = 0",
    MANAGED_PROVIDER_END,
  ].join("\n");

  return [root, rootBlock, tables, providerBlock].filter(Boolean).join("\n\n") + "\n";
}

export async function installCodexConfig(
  paths: ClientPaths,
  connection: ConnectionConfig,
  executablePath: string,
): Promise<void> {
  await mkdir(dirname(paths.codexConfigFile), { recursive: true, mode: 0o700 });
  let current = "";
  try {
    current = await readFile(paths.codexConfigFile, "utf8");
  } catch {
    // A first Codex installation legitimately has no config yet.
  }

  try {
    await stat(paths.codexConfigBackupFile);
  } catch {
    if (current) {
      await copyFile(paths.codexConfigFile, paths.codexConfigBackupFile);
      await chmod(paths.codexConfigBackupFile, 0o600);
    }
  }

  await writePrivateFile(paths.codexConfigFile, renderCodexConfig(current, paths, connection, executablePath));
}
