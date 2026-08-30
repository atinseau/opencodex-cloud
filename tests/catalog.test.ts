import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { probeCatalog, syncCatalog } from "../src/catalog";
import { createConnection } from "../src/connection";
import { resolvePaths } from "../src/paths";
import { writePrivateFile } from "../src/files";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function testPaths() {
  const root = await mkdtemp(join(tmpdir(), "opencodex-cloud-test-"));
  temporaryDirectories.push(root);
  return resolvePaths({ HOME: root, OPENCODEX_CLOUD_HOME: join(root, "client"), CODEX_HOME: join(root, "codex") });
}

describe("syncCatalog", () => {
  test("écrit un catalogue privé puis utilise l’ETag", async () => {
    const paths = await testPaths();
    const requests: Request[] = [];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      if (requests.length === 2) return new Response(null, { status: 304 });
      return new Response(JSON.stringify({ models: [{ slug: "openai/gpt-test" }] }), {
        status: 200,
        headers: { etag: '"catalog-v1"', "content-type": "application/json" },
      });
    });

    const first = await syncCatalog(paths, createConnection("https://ai.example.com"), "secret-key", fetcher);
    const second = await syncCatalog(paths, createConnection("https://ai.example.com"), "secret-key", fetcher);

    expect(first).toEqual({ status: "updated", models: 1 });
    expect(second).toEqual({ status: "unchanged" });
    expect(JSON.parse(await readFile(paths.catalogFile, "utf8"))).toEqual({ models: [{ slug: "openai/gpt-test" }] });
    expect(requests[0]?.headers.get("x-opencodex-api-key")).toBe("secret-key");
    expect(requests[1]?.headers.get("if-none-match")).toBe('"catalog-v1"');
    expect((await stat(paths.catalogFile)).mode & 0o777).toBe(0o600);
  });

  test("ne remplace pas le dernier catalogue valide par une réponse invalide", async () => {
    const paths = await testPaths();
    const good = async () => new Response(JSON.stringify({ models: [{ slug: "good" }] }), { status: 200 });
    const invalid = async () => new Response(JSON.stringify({ data: [] }), { status: 200 });
    await syncCatalog(paths, createConnection("https://ai.example.com"), "secret-key", good);

    await expect(syncCatalog(paths, createConnection("https://ai.example.com"), "secret-key", invalid)).rejects.toThrow("format Codex");
    expect(JSON.parse(await readFile(paths.catalogFile, "utf8"))).toEqual({ models: [{ slug: "good" }] });
  });

  test("rend un refus d’authentification explicite", async () => {
    const paths = await testPaths();
    const denied = async () => new Response("unauthorized", { status: 401 });
    await expect(syncCatalog(paths, createConnection("https://ai.example.com"), "wrong", denied)).rejects.toThrow("clé API a été refusée");
  });

  test("ignore un ETag orphelin lorsque le catalogue local a disparu", async () => {
    const paths = await testPaths();
    await writePrivateFile(paths.stateFile, JSON.stringify({ etag: '"stale"' }));
    const requests: Request[] = [];
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      return new Response(JSON.stringify({ models: [] }), { status: 200 });
    };

    await syncCatalog(paths, createConnection("https://ai.example.com"), "secret", fetcher);
    expect(requests[0]?.headers.has("if-none-match")).toBeFalse();
  });
});

describe("probeCatalog", () => {
  test("valide le catalogue sans écrire sur le disque", async () => {
    const probe = await probeCatalog(
      createConnection("https://ai.example.com"),
      "secret",
      async () => Response.json({ models: [{ slug: "one" }] }, {
        headers: { etag: '"v1"', "x-opencodex-codex-version": "0.151.0" },
      }),
    );
    expect(probe).toEqual({ models: 1, etag: '"v1"', codexVersion: "0.151.0" });
  });
});
