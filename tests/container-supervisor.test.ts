import { describe, expect, test } from "bun:test";
import {
  createCatalogReconciler,
  parseCatalogSyncInterval,
  type IntervalScheduler,
} from "../docker/supervisor";

describe("parseCatalogSyncInterval", () => {
  test("active une convergence toutes les cinq minutes par défaut", () => {
    expect(parseCatalogSyncInterval(undefined)).toBe(300_000);
  });

  test("accepte la désactivation explicite", () => {
    expect(parseCatalogSyncInterval("0")).toBe(0);
  });

  test("refuse les intervalles agressifs ou ambigus", () => {
    expect(() => parseCatalogSyncInterval("29")).toThrow("at least 30 seconds");
    expect(() => parseCatalogSyncInterval("5m")).toThrow("integer number of seconds");
  });
});

describe("createCatalogReconciler", () => {
  test("réconcilie le catalogue via le management local sans exposer le token dans l’URL", async () => {
    const callbacks: Array<() => void> = [];
    const delays: number[] = [];
    const scheduler: IntervalScheduler = {
      set(callback, delay) {
        callbacks.push(callback);
        delays.push(delay);
        return Symbol("timer");
      },
      clear() {},
    };
    const requests: Request[] = [];
    const reconciler = createCatalogReconciler({
      port: 10100,
      adminToken: "admin-secret-value",
      intervalMs: 30_000,
      scheduler,
      fetcher: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({ ok: true });
      },
      logger: { info() {}, error() {} },
    });

    reconciler.start();
    expect(delays).toEqual([30_000]);
    expect(callbacks).toHaveLength(1);
    callbacks[0]!();
    await reconciler.whenIdle();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://127.0.0.1:10100/api/sync");
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer admin-secret-value");
    expect(requests[0]?.url).not.toContain("admin-secret-value");
  });

  test("ne lance jamais deux convergences simultanées", async () => {
    const callbacks: Array<() => void> = [];
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const reconciler = createCatalogReconciler({
      port: 10100,
      adminToken: "admin-secret-value",
      intervalMs: 30_000,
      scheduler: {
        set(callback) {
          callbacks.push(callback);
          return Symbol("timer");
        },
        clear() {},
      },
      fetcher: async () => {
        calls += 1;
        await pending;
        return Response.json({ ok: true });
      },
      logger: { info() {}, error() {} },
    });

    reconciler.start();
    callbacks[0]!();
    callbacks[0]!();
    await Bun.sleep(0);
    expect(calls).toBe(1);
    release();
    await reconciler.whenIdle();
  });
});
