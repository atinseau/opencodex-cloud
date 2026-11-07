import { Config, Schema } from "effect"

const EndpointUrl = Schema.String.check(
  Schema.isPattern(
    /^(?:https:\/\/[^\s/?#]+|http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?)(?:\/[\w.~-]+)+$/u,
  ),
)

export interface PublicEndpoint {
  /** The MCP endpoint URL entered in Claude, such as `https://example.com/mcp`. */
  readonly url: string
  readonly origin: string
  /** Path of the MCP endpoint. Every other connector route is mounted below it. */
  readonly path: `/${string}`
}

/**
 * Public URL of the MCP endpoint. Claude uses it as the OAuth resource and issuer, so it must be
 * the exact URL entered in Claude, without a trailing slash. The connector can therefore share a
 * domain with other services: only this path and its `/.well-known/*` documents belong to it.
 * Plain HTTP is accepted only for loopback development.
 */
export const publicEndpoint = Config.schema(EndpointUrl, "MCP_PUBLIC_URL").pipe(
  Config.map((url): PublicEndpoint => {
    const parsed = new URL(url)
    return { url, origin: parsed.origin, path: `/${parsed.pathname.slice(1)}` }
  }),
)
