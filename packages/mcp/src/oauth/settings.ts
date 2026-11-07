import { Config, Context, Effect, Layer, Schema } from "effect"
import type { Redacted } from "effect"

import { publicEndpoint } from "../config.ts"

const ClientSecret = Schema.RedactedFromValue(Schema.String.check(Schema.isMinLength(32)))

/**
 * The single confidential OAuth client allowed to connect. Claude receives its identifier and
 * secret through the custom connector's advanced settings.
 */
export class OAuthSettings extends Context.Service<
  OAuthSettings,
  {
    readonly path: `/${string}`
    readonly issuer: string
    readonly resource: string
    readonly resourceMetadataUrl: string
    readonly clientId: string
    readonly clientSecret: Redacted.Redacted
  }
>()("opencodex-cloud/mcp/oauth/OAuthSettings") {
  static readonly layer = Layer.effect(
    OAuthSettings,
    Effect.gen(function* () {
      const endpoint = yield* publicEndpoint
      const clientId = yield* Config.schema(Schema.NonEmptyString, "MCP_OAUTH_CLIENT_ID")
      const clientSecret = yield* Config.schema(ClientSecret, "MCP_OAUTH_CLIENT_SECRET")
      return OAuthSettings.of({
        path: endpoint.path,
        issuer: endpoint.url,
        resource: endpoint.url,
        resourceMetadataUrl: `${endpoint.origin}/.well-known/oauth-protected-resource${endpoint.path}`,
        clientId,
        clientSecret,
      })
    }),
  )
}
