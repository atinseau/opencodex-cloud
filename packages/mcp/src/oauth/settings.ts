import { Config, Context, Effect, Layer, Schema } from "effect"
import type { Redacted } from "effect"

import { publicOrigin } from "../config.ts"

const ClientSecret = Schema.RedactedFromValue(Schema.String.check(Schema.isMinLength(32)))

/**
 * The single confidential OAuth client allowed to connect. Claude receives its identifier and
 * secret through the custom connector's advanced settings.
 */
export class OAuthSettings extends Context.Service<
  OAuthSettings,
  {
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
      const issuer = yield* publicOrigin
      const clientId = yield* Config.schema(Schema.NonEmptyString, "MCP_OAUTH_CLIENT_ID")
      const clientSecret = yield* Config.schema(ClientSecret, "MCP_OAUTH_CLIENT_SECRET")
      return OAuthSettings.of({
        issuer,
        resource: `${issuer}/mcp`,
        resourceMetadataUrl: `${issuer}/.well-known/oauth-protected-resource/mcp`,
        clientId,
        clientSecret,
      })
    }),
  )
}
