import { describe, expect, test } from "bun:test";
import { probeLocalOpenCodex } from "../src/local-proxy";

describe("probeLocalOpenCodex", () => {
  test("détecte le port local configuré avant le port par défaut", async () => {
    const requested: string[] = [];
    const result = await probeLocalOpenCodex("http://127.0.0.1:11400/v1", async (input) => {
      requested.push(String(input));
      return Response.json({ service: "opencodex", status: "ok" });
    });

    expect(result).toEqual({ running: true, endpoint: "http://127.0.0.1:11400" });
    expect(requested).toEqual(["http://127.0.0.1:11400/healthz"]);
  });

  test("ignore un service différent qui occupe le port", async () => {
    const result = await probeLocalOpenCodex(undefined, async () => Response.json({ service: "other" }));
    expect(result).toEqual({ running: false });
  });
});
