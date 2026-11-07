import { Effect, Layer } from "effect"
import { HttpRouter } from "effect/http"

import { authorize } from "./authorize.ts"
import { BearerAuth } from "./bearer.ts"
import { AuthorizationCodes } from "./codes.ts"
import { authorizationServerMetadata, protectedResourceMetadata } from "./metadata.ts"
import { OAuthSettings } from "./settings.ts"
import { tokenEndpoint } from "./token-endpoint.ts"
import { Tokens } from "./tokens.ts"

const Routes = HttpRouter.use(
  Effect.fn(function* (router) {
    const settings = yield* OAuthSettings
    const codes = yield* AuthorizationCodes
    const tokens = yield* Tokens
    const { path } = settings
    const resourceMetadata = protectedResourceMetadata(settings)
    const serverMetadata = authorizationServerMetadata(settings)
    // RFC 9728 and RFC 8414 insert the endpoint path after the well-known prefix; OpenID
    // Connect discovery also allows appending it. Clients try these locations in turn.
    yield* router.add("GET", `/.well-known/oauth-protected-resource${path}`, resourceMetadata)
    yield* router.add("GET", `/.well-known/oauth-authorization-server${path}`, serverMetadata)
    yield* router.add("GET", `/.well-known/openid-configuration${path}`, serverMetadata)
    yield* router.add("GET", `${path}/.well-known/openid-configuration`, serverMetadata)
    yield* router.add("GET", `${path}/authorize`, authorize(settings, codes))
    yield* router.add("POST", `${path}/token`, tokenEndpoint({ settings, codes, tokens }))
  }),
)

/** OAuth 2.1 authorization server for Claude and the bearer check protecting the MCP endpoint. */
export const OAuth = Layer.mergeAll(Routes, BearerAuth).pipe(
  Layer.provide(Layer.mergeAll(Tokens.layer, AuthorizationCodes.layer)),
  Layer.provideMerge(OAuthSettings.layer),
)
