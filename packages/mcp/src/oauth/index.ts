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
    const resourceMetadata = protectedResourceMetadata(settings)
    yield* router.add("GET", "/.well-known/oauth-protected-resource", resourceMetadata)
    yield* router.add("GET", "/.well-known/oauth-protected-resource/mcp", resourceMetadata)
    yield* router.add(
      "GET",
      "/.well-known/oauth-authorization-server",
      authorizationServerMetadata(settings),
    )
    yield* router.add("GET", "/authorize", authorize(settings, codes))
    yield* router.add("POST", "/token", tokenEndpoint({ settings, codes, tokens }))
  }),
)

/** OAuth 2.1 authorization server for Claude and the bearer check protecting `/mcp`. */
export const OAuth = Layer.mergeAll(Routes, BearerAuth).pipe(
  Layer.provide(Layer.mergeAll(Tokens.layer, AuthorizationCodes.layer)),
  Layer.provideMerge(OAuthSettings.layer),
)
