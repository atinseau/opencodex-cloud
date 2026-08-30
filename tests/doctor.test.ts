import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { diagnose, type DoctorDependencies } from "../src/doctor";
import { createConnection, saveConnection, saveCredential } from "../src/connection";
import { resolvePaths } from "../src/paths";
import { beginCloudRoutingSwitch, installCodexConfig } from "../src/codex-config";
import { writePrivateFile } from "../src/files";

const temporaryDirectories: string[] = [];
const now = new Date("2026-08-30T12:00:00.000Z");

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function installedClient() {
  const root = await mkdtemp(join(tmpdir(), "opencodex-cloud-doctor-"));
  temporaryDirectories.push(root);
  const paths = resolvePaths({
    HOME: root,
    OPENCODEX_CLOUD_HOME: join(root, "client"),
    CODEX_HOME: join(root, "codex"),
    XDG_STATE_HOME: join(root, "state"),
  });
  const connection = createConnection("https://ai.example.com");
  await saveConnection(paths, connection);
  await saveCredential(paths, "machine-secret");
  await writePrivateFile(paths.catalogFile, JSON.stringify({ models: [{ slug: "openai/gpt-test" }] }));
  await writePrivateFile(paths.stateFile, JSON.stringify({ lastCheckedAt: "2026-08-30T11:59:45.000Z" }));
  await beginCloudRoutingSwitch(paths);
  await installCodexConfig(paths, connection, "/bin/sh");
  return { paths, connection };
}

function healthyDependencies(requests: Request[]): DoctorDependencies {
  return {
    now: () => now,
    findCodex: () => "/usr/local/bin/codex",
    inspectService: async () => "LaunchAgent actif",
    probeLocal: async () => ({ running: false }),
    fetcher: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      const path = new URL(request.url).pathname;
      if (path === "/healthz") return Response.json({ service: "opencodex", status: "ok" });
      if (path === "/readyz") return Response.json({ service: "opencodex", status: "ready" });
      if (path === "/v1/catalog") {
        return Response.json({ models: [{ slug: "one" }, { slug: "two" }] }, {
          headers: { etag: '"catalog"', "x-opencodex-codex-version": "0.151.0" },
        });
      }
      if (path === "/v1/models") return Response.json({ data: [{ id: "one" }, { id: "two" }] });
      return Response.json({ error: "not found" }, { status: 404 });
    },
  };
}

describe("diagnose", () => {
  test("vérifie toute la chaîne sans exposer la clé", async () => {
    const { paths } = await installedClient();
    const requests: Request[] = [];
    const report = await diagnose(paths, healthyDependencies(requests));

    expect(report.ok).toBeTrue();
    expect(report.checks.every((check) => check.status === "pass")).toBeTrue();
    expect(report.checks.find((check) => check.id === "remote-catalog")?.detail).toContain("2 modèles");
    expect(requests.find((request) => new URL(request.url).pathname === "/v1/catalog")?.headers.get("x-opencodex-api-key")).toBe("machine-secret");
    expect(requests.find((request) => new URL(request.url).pathname === "/v1/models")?.headers.get("authorization")).toBe("Bearer machine-secret");
    expect(JSON.stringify(report)).not.toContain("machine-secret");
  });

  test("retourne un échec lorsque le bearer est refusé", async () => {
    const { paths } = await installedClient();
    const dependencies = healthyDependencies([]);
    const healthyFetcher = dependencies.fetcher;
    dependencies.fetcher = async (input, init) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname;
      if (path === "/v1/catalog" || path === "/v1/models") {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      return healthyFetcher(input, init);
    };

    const report = await diagnose(paths, dependencies);
    expect(report.ok).toBeFalse();
    expect(report.checks.find((check) => check.id === "remote-catalog")?.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "models-api")?.status).toBe("fail");
  });

  test("signale un proxy local actif mais non utilisé en mode Cloud", async () => {
    const { paths } = await installedClient();
    const dependencies = healthyDependencies([]);
    dependencies.probeLocal = async () => ({ running: true, endpoint: "http://127.0.0.1:10100" });

    const report = await diagnose(paths, dependencies);
    expect(report.ok).toBeTrue();
    expect(report.mode).toBe("cloud");
    expect(report.checks.find((check) => check.id === "local-proxy")?.status).toBe("warn");
    expect(report.checks.find((check) => check.id === "local-proxy")?.detail).toContain("non utilisé");
  });

  test("valide le mode local et ne contacte pas le serveur Cloud après disconnect", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencodex-cloud-local-doctor-"));
    temporaryDirectories.push(root);
    const paths = resolvePaths({ HOME: root, CODEX_HOME: join(root, "codex") });
    await writePrivateFile(paths.codexConfigFile, [
      'model_provider = "openai"',
      'openai_base_url = "http://127.0.0.1:10100/v1"',
    ].join("\n"));
    const requests: Request[] = [];
    const dependencies = healthyDependencies(requests);
    dependencies.probeLocal = async () => ({ running: true, endpoint: "http://127.0.0.1:10100" });

    const report = await diagnose(paths, dependencies);
    expect(report.ok).toBeTrue();
    expect(report.mode).toBe("opencodex-local");
    expect(report.checks.find((check) => check.id === "local-proxy")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "proxy-health")?.status).toBe("skip");
    expect(requests).toHaveLength(0);
  });
});
