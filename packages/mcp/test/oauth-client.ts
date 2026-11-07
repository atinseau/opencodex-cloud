import { Schema } from "effect"
import * as Base64Url from "effect/encoding/Base64Url"

import { CLIENT_ID, CLIENT_SECRET, HOSTED_CALLBACK } from "./harness.ts"
import type { TestServer } from "./harness.ts"

const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
  token_type: Schema.Literal("Bearer"),
  expires_in: Schema.Finite,
})
export const decodeTokens = Schema.decodeUnknownSync(TokenResponse)

export const pkce = () => {
  const verifier = Base64Url.encode(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = new Bun.CryptoHasher("sha256").update(verifier).digest("base64url")
  return { verifier, challenge }
}

export const authorizeUrl = (params: Readonly<Record<string, string>>) =>
  `/mcp/authorize?${new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: HOSTED_CALLBACK,
    code_challenge_method: "S256",
    ...params,
  }).toString()}`

export const basicAuth = (secret = CLIENT_SECRET) => `Basic ${btoa(`${CLIENT_ID}:${secret}`)}`

export const postToken = (
  server: TestServer,
  form: Readonly<Record<string, string>>,
  authorization = basicAuth(),
) =>
  server.request("/mcp/token", {
    method: "POST",
    headers: { authorization, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  })

/** Obtains an authorization code for a fresh PKCE pair. */
export const authorizeCode = async (server: TestServer) => {
  const { verifier, challenge } = pkce()
  const response = await server.request(authorizeUrl({ code_challenge: challenge, state: "s" }))
  const code = new URL(response.headers.get("location") ?? "").searchParams.get("code") ?? ""
  return { code, verifier }
}

/** Runs the authorization-code flow and returns the issued tokens. */
export const signIn = async (server: TestServer) => {
  const { code, verifier } = await authorizeCode(server)
  const response = await postToken(server, {
    grant_type: "authorization_code",
    code,
    redirect_uri: HOSTED_CALLBACK,
    code_verifier: verifier,
  })
  return decodeTokens(await response.json())
}
