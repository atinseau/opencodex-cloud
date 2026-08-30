import { chmod, copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import type { ClientPaths } from "./paths";
import type { ConnectionConfig } from "./connection";
import { PROVIDER_ID } from "./constants";
import { writePrivateFile } from "./files";

const MANAGED_ROOT_START = "# >>> opencodex-cloud root";
const MANAGED_ROOT_END = "# <<< opencodex-cloud root";
const MANAGED_PROVIDER_START = "# >>> opencodex-cloud provider";
const MANAGED_PROVIDER_END = "# <<< opencodex-cloud provider";

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
