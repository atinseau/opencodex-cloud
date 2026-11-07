import { Config, Schema } from "effect"

const PublicOrigin = Schema.String.check(
  Schema.isPattern(/^(?:https:\/\/[^\s/?#]+|http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?)$/u),
)

/**
 * Public origin of this server, such as `https://mcp.example.com`. Every URL advertised to Claude
 * derives from it, so it must be the exact origin users enter, without a path or trailing slash.
 * Plain HTTP is accepted only for loopback development.
 */
export const publicOrigin = Config.schema(PublicOrigin, "MCP_PUBLIC_URL")
