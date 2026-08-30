import { describe, expect, test } from "bun:test";
import { renderCodexConfig } from "../src/codex-config";
import { createConnection } from "../src/connection";
import { resolvePaths } from "../src/paths";

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
});
