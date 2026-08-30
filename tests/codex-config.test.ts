import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  beginCloudRoutingSwitch,
  inspectCodexRouting,
  installCodexConfig,
  restorePreviousCodexRouting,
  renderCodexConfig,
} from "../src/codex-config";
import { createConnection } from "../src/connection";
import { resolvePaths } from "../src/paths";
import { writePrivateFile } from "../src/files";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const paths = resolvePaths({
  HOME: "/Users/tester",
  CODEX_HOME: "/Users/tester/.codex",
});

describe("renderCodexConfig", () => {
  test("place les clés racine avant les tables et conserve les réglages existants", () => {
    const result = renderCodexConfig(
      `model = "gpt-existing"\nmodel_provider = "old"\n\n[features]\nmulti_agent = true\n`,
      paths,
      createConnection("https://ai.example.com"),
      "/Users/tester/.local/bin/opencodex-cloud",
    );

    expect(result.indexOf("model_provider = \"opencodex_cloud\"")).toBeLessThan(result.indexOf("[features]"));
    expect(result).toContain('model = "gpt-existing"');
    expect(result).toContain("multi_agent = true");
    expect(result).toContain('model_catalog_json = "/Users/tester/.codex/opencodex-cloud-catalog.json"');
    expect(result).toContain('[model_providers.opencodex_cloud.auth]');
    expect(result).toContain('args = ["auth-token"]');
    expect(result).not.toContain("requires_openai_auth");
    expect(result).not.toContain("env_key");
  });

  test("est idempotent et remplace une ancienne table du même provider", () => {
    const connection = createConnection("https://ai.example.com");
    const existing = `[model_providers.opencodex_cloud]\nbase_url = "https://old.invalid/v1"\n\n[features]\nfoo = true\n`;
    const once = renderCodexConfig(existing, paths, connection, "/bin/opencodex-cloud");
    const twice = renderCodexConfig(once, paths, connection, "/bin/opencodex-cloud");

    expect(twice).toBe(once);
    expect(twice.match(/\[model_providers\.opencodex_cloud]/g)).toHaveLength(1);
    expect(twice).not.toContain("old.invalid");
  });

  test("reconnaît la configuration loopback moderne injectée par OpenCodex", () => {
    const routing = inspectCodexRouting([
      'model_provider = "openai"',
      'model_catalog_json = "/Users/tester/.codex/opencodex-catalog.json"',
      '# >>> opencodex managed',
      'openai_base_url = "http://127.0.0.1:10100/v1"',
    ].join("\n"));

    expect(routing.mode).toBe("opencodex-local");
    expect(routing.endpoint).toBe("http://127.0.0.1:10100/v1");
  });

  test("disconnect restaure seulement le routage précédent et conserve les changements récents", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencodex-cloud-routing-"));
    temporaryDirectories.push(root);
    const isolatedPaths = resolvePaths({
      HOME: root,
      OPENCODEX_CLOUD_HOME: join(root, "client"),
      CODEX_HOME: join(root, "codex"),
    });
    const localConfig = [
      'model_provider = "openai"',
      'model_catalog_json = "/tmp/opencodex-local.json"',
      'openai_base_url = "http://127.0.0.1:10100/v1"',
      "",
      "[features]",
      "multi_agent = true",
      "",
    ].join("\n");
    await writePrivateFile(isolatedPaths.codexConfigFile, localConfig);
    await beginCloudRoutingSwitch(isolatedPaths);
    await installCodexConfig(
      isolatedPaths,
      createConnection("https://ai.example.com"),
      "/bin/opencodex-cloud",
    );
    await writePrivateFile(
      isolatedPaths.codexConfigFile,
      `${await readFile(isolatedPaths.codexConfigFile, "utf8")}\n[projects."/tmp/new"]\ntrust_level = "trusted"\n`,
    );

    const restored = await restorePreviousCodexRouting(isolatedPaths);
    const source = await readFile(isolatedPaths.codexConfigFile, "utf8");
    expect(restored.mode).toBe("opencodex-local");
    expect(source).toContain('model_provider = "openai"');
    expect(source).toContain('model_catalog_json = "/tmp/opencodex-local.json"');
    expect(source).toContain('openai_base_url = "http://127.0.0.1:10100/v1"');
    expect(source).toContain('[projects."/tmp/new"]');
    expect(source).not.toContain("opencodex_cloud");
    expect(await Bun.file(isolatedPaths.routingStateFile).exists()).toBeFalse();
  });

  test("migre une installation 0.2 depuis sa sauvegarde sans restaurer tout le fichier", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencodex-cloud-legacy-routing-"));
    temporaryDirectories.push(root);
    const isolatedPaths = resolvePaths({
      HOME: root,
      OPENCODEX_CLOUD_HOME: join(root, "client"),
      CODEX_HOME: join(root, "codex"),
    });
    const previous = [
      'model_provider = "opencodex"',
      'model_catalog_json = "/tmp/local-catalog.json"',
      "",
      "[model_providers.opencodex]",
      'base_url = "http://127.0.0.1:10100/v1"',
      "",
      "[features]",
      "old_setting = true",
      "",
    ].join("\n");
    await writePrivateFile(isolatedPaths.codexConfigBackupFile, previous);
    const currentBeforeCloud = [
      'model_provider = "opencodex"',
      'model_catalog_json = "/tmp/local-catalog.json"',
      "",
      "[model_providers.opencodex]",
      'base_url = "http://127.0.0.1:10100/v1"',
      "",
      "[features]",
      "current_setting = true",
      "",
    ].join("\n");
    await writePrivateFile(
      isolatedPaths.codexConfigFile,
      renderCodexConfig(currentBeforeCloud, isolatedPaths, createConnection("https://ai.example.com"), "/bin/opencodex-cloud"),
    );

    await beginCloudRoutingSwitch(isolatedPaths);
    const restored = await restorePreviousCodexRouting(isolatedPaths);
    const source = await readFile(isolatedPaths.codexConfigFile, "utf8");
    expect(restored.mode).toBe("opencodex-local");
    expect(source).toContain('model_provider = "opencodex"');
    expect(source).toContain('model_catalog_json = "/tmp/local-catalog.json"');
    expect(source).toContain("current_setting = true");
    expect(source).not.toContain("old_setting = true");
  });
});
