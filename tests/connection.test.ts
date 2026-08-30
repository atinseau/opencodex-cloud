import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createConnection, normalizeServerUrl, readConnection, readCredential } from "../src/connection";
import { resolvePaths } from "../src/paths";

describe("normalizeServerUrl", () => {
  test("normalise une origine HTTPS", () => {
    expect(normalizeServerUrl("  https://ai.example.com/ ")).toBe("https://ai.example.com");
    expect(createConnection("https://ai.example.com").catalogUrl).toBe("https://ai.example.com/v1/catalog");
  });

  test("autorise HTTP uniquement en loopback", () => {
    expect(normalizeServerUrl("http://127.0.0.1:10100")).toBe("http://127.0.0.1:10100");
    expect(() => normalizeServerUrl("http://ai.example.com")).toThrow("HTTPS est obligatoire");
  });

  test("refuse les identifiants et les chemins ambigus", () => {
    expect(() => normalizeServerUrl("https://user:secret@ai.example.com")).toThrow();
    expect(() => normalizeServerUrl("https://ai.example.com/proxy")).toThrow("origine du serveur");
    expect(() => normalizeServerUrl("https://ai.example.com/?next=x")).toThrow();
  });
});

describe("readCredential", () => {
  test("refuse un secret lisible par le groupe ou les autres comptes", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(join(tmpdir(), "opencodex-cloud-credential-"));
    try {
      const paths = resolvePaths({ HOME: root, OPENCODEX_CLOUD_HOME: root });
      await writeFile(paths.credentialFile, "secret\n", { mode: 0o600 });
      expect(await readCredential(paths)).toBe("secret");
      await chmod(paths.credentialFile, 0o644);
      await expect(readCredential(paths)).rejects.toThrow("introuvable ou invalide");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("readConnection", () => {
  test("reconstruit toujours le endpoint catalogue depuis l’origine validée", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencodex-cloud-connection-"));
    try {
      const paths = resolvePaths({ HOME: root, OPENCODEX_CLOUD_HOME: root });
      await writeFile(paths.connectionFile, JSON.stringify({
        serverUrl: "https://ai.example.com",
        catalogUrl: "https://attacker.invalid/steal",
      }), { mode: 0o600 });
      expect((await readConnection(paths)).catalogUrl).toBe("https://ai.example.com/v1/catalog");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
