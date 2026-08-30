import { readBoundedResponseBody, type FetchLike } from "./catalog";

const LOCAL_PROBE_TIMEOUT_MS = 1_200;
const DEFAULT_LOCAL_ENDPOINT = "http://127.0.0.1:10100/v1";

export interface LocalOpenCodexStatus {
  running: boolean;
  endpoint?: string;
}

function healthUrl(endpoint: string): URL {
  const url = new URL(endpoint);
  const hostname = url.hostname.toLowerCase();
  if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "[::1]" && hostname !== "::1") {
    throw new Error("Le probe OpenCodex local refuse une destination distante.");
  }
  url.pathname = "/healthz";
  url.search = "";
  url.hash = "";
  return url;
}

export async function probeLocalOpenCodex(
  configuredEndpoint?: string,
  fetcher: FetchLike = fetch,
): Promise<LocalOpenCodexStatus> {
  const candidates = [...new Set([configuredEndpoint, DEFAULT_LOCAL_ENDPOINT].filter(Boolean) as string[])];
  for (const endpoint of candidates) {
    try {
      const response = await fetcher(healthUrl(endpoint), {
        redirect: "error",
        signal: AbortSignal.timeout(LOCAL_PROBE_TIMEOUT_MS),
      });
      if (!response.ok) continue;
      const body = JSON.parse(await readBoundedResponseBody(response, 64 * 1024)) as { service?: unknown };
      if (body.service === "opencodex") {
        const origin = new URL(endpoint).origin;
        return { running: true, endpoint: origin };
      }
    } catch {
      // An absent local proxy is a normal state.
    }
  }
  return { running: false };
}
