import { HttpServerResponse } from "effect/http"

import type { OAuthSettings } from "./settings.ts"

/** RFC 9728 protected resource metadata for the `/mcp` endpoint. */
export const protectedResourceMetadata = (settings: OAuthSettings["Service"]) =>
  HttpServerResponse.jsonUnsafe({
    resource: settings.resource,
    authorization_servers: [settings.issuer],
    bearer_methods_supported: ["header"],
  })

/**
 * RFC 8414 authorization server metadata. It advertises neither dynamic registration nor client ID
 * metadata documents: Claude must use the pre-registered confidential client.
 */
export const authorizationServerMetadata = (settings: OAuthSettings["Service"]) =>
  HttpServerResponse.jsonUnsafe({
    issuer: settings.issuer,
    authorization_endpoint: `${settings.issuer}/authorize`,
    token_endpoint: `${settings.issuer}/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
  })
