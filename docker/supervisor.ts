const DEFAULT_CATALOG_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const MINIMUM_CATALOG_SYNC_INTERVAL_SECONDS = 30;

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface IntervalScheduler {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

export interface CatalogReconciler {
  start(): void;
  stop(): void;
  whenIdle(): Promise<void>;
}

interface CatalogReconcilerOptions {
  port: number;
  adminToken: string;
  intervalMs: number;
  fetcher?: Fetcher;
  scheduler?: IntervalScheduler;
  logger?: Pick<Console, "info" | "error">;
}

const systemScheduler: IntervalScheduler = {
  set(callback, delayMs) {
    return setInterval(callback, delayMs);
  },
  clear(handle) {
    clearInterval(handle as ReturnType<typeof setInterval>);
  },
};

export function parseCatalogSyncInterval(value: string | undefined): number {
  const raw = value?.trim();
  if (!raw) return DEFAULT_CATALOG_SYNC_INTERVAL_MS;
  if (!/^\d+$/.test(raw)) {
    throw new Error("CATALOG_SYNC_INTERVAL_SECONDS must be an integer number of seconds");
  }
  const seconds = Number(raw);
  if (!Number.isSafeInteger(seconds)) {
    throw new Error("CATALOG_SYNC_INTERVAL_SECONDS is outside the supported range");
  }
  if (seconds === 0) return 0;
  if (seconds < MINIMUM_CATALOG_SYNC_INTERVAL_SECONDS) {
    throw new Error(`CATALOG_SYNC_INTERVAL_SECONDS must be 0 or at least ${MINIMUM_CATALOG_SYNC_INTERVAL_SECONDS} seconds`);
  }
  return seconds * 1000;
}

export function createCatalogReconciler(options: CatalogReconcilerOptions): CatalogReconciler {
  const fetcher = options.fetcher ?? fetch;
  const scheduler = options.scheduler ?? systemScheduler;
  const logger = options.logger ?? console;
  const endpoint = `http://127.0.0.1:${options.port}/api/sync`;
  let timer: unknown;
  let started = false;
  let stopped = false;
  let running = false;
  let current = Promise.resolve();

  const trigger = () => {
    if (stopped || running) return;
    running = true;
    current = (async () => {
      try {
        const response = await fetcher(endpoint, {
          method: "POST",
          headers: { authorization: `Bearer ${options.adminToken}` },
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) throw new Error(`management API returned HTTP ${response.status}`);
        const result = await response.json().catch(() => ({})) as {
          catalogWritten?: boolean;
          cacheSynced?: boolean;
        };
        if (result.catalogWritten || result.cacheSynced) {
          logger.info("[catalog-sync] dynamic catalog refreshed");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        logger.error(`[catalog-sync] refresh failed: ${message}`);
      } finally {
        running = false;
      }
    })();
  };

  return {
    start() {
      if (started) return;
      started = true;
      if (options.intervalMs > 0) timer = scheduler.set(trigger, options.intervalMs);
    },
    stop() {
      stopped = true;
      if (timer !== undefined) scheduler.clear(timer);
    },
    whenIdle() {
      return current;
    },
  };
}

async function supervise(): Promise<void> {
  const port = Number(process.env.PORT ?? "10100");
  const adminToken = process.env.OPENCODEX_ADMIN_AUTH_TOKEN ?? "";
  const intervalMs = parseCatalogSyncInterval(process.env.CATALOG_SYNC_INTERVAL_SECONDS);
  const opencodexEntry = process.env.OPENCODEX_ENTRYPOINT
    ?? "/opt/bun-global/install/global/node_modules/@bitkyc08/opencodex/src/cli/index.ts";
  const child = Bun.spawn(
    [process.execPath, "run", opencodexEntry, "start", "--port", String(port)],
    {
      env: process.env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  const reconciler = createCatalogReconciler({ port, adminToken, intervalMs });
  reconciler.start();

  let stopping = false;
  const forward = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    reconciler.stop();
    child.kill(signal);
  };
  const onSigint = () => forward("SIGINT");
  const onSigterm = () => forward("SIGTERM");
  const onSighup = () => forward("SIGHUP");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  process.on("SIGHUP", onSighup);

  const exitCode = await child.exited;
  reconciler.stop();
  await reconciler.whenIdle();
  process.off("SIGINT", onSigint);
  process.off("SIGTERM", onSigterm);
  process.off("SIGHUP", onSighup);
  process.exitCode = exitCode;
}

if (import.meta.main) {
  await supervise();
}
