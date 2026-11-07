import { afterAll, beforeAll, describe, expect, test } from "bun:test"

import { HOSTED_CALLBACK, ORIGIN, startServer } from "./harness.ts"
import type { TestServer } from "./harness.ts"
import {
  authorizeCode,
  authorizeUrl,
  basicAuth,
  decodeTokens,
  pkce,
  postToken,
  signIn,
} from "./oauth-client.ts"

let server: TestServer

beforeAll(async () => {
  server = await startServer()
})

afterAll(async () => {
  await server.dispose()
})

describe("discovery", () => {
  test("an unauthenticated MCP call receives a 401 pointing at the resource metadata", async () => {
    const response = await server.request("/mcp", { method: "POST", body: "{}" })
    expect(response.status).toBe(401)
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
    )
  })

  test("the metadata names this server as the issuer and requires a pre-registered client", async () => {
    const resource: unknown = await (
      await server.request("/.well-known/oauth-protected-resource/mcp")
    ).json()
    expect(resource).toMatchObject({ resource: `${ORIGIN}/mcp`, authorization_servers: [ORIGIN] })

    const issuer: unknown = await (
      await server.request("/.well-known/oauth-authorization-server")
    ).json()
    expect(issuer).toMatchObject({
      issuer: ORIGIN,
      token_endpoint: `${ORIGIN}/token`,
      code_challenge_methods_supported: ["S256"],
    })
    expect(issuer).not.toHaveProperty("registration_endpoint")
    expect(issuer).not.toHaveProperty("client_id_metadata_document_supported")
  })
})

describe("authorization", () => {
  test("redirects Claude back with a code and its state", async () => {
    const response = await server.request(
      authorizeUrl({ code_challenge: pkce().challenge, state: "abc" }),
    )
    const location = new URL(response.headers.get("location") ?? "")
    expect(response.status).toBe(302)
    expect(`${location.origin}${location.pathname}`).toBe(HOSTED_CALLBACK)
    expect(location.searchParams.get("state")).toBe("abc")
    expect(location.searchParams.get("code")).toMatch(/^[\w-]{43}$/u)
  })

  test("accepts the loopback callback used by Claude Code on any port", async () => {
    const redirect = "http://127.0.0.1:53682/callback"
    const response = await server.request(
      authorizeUrl({ code_challenge: pkce().challenge, redirect_uri: redirect }),
    )
    expect(response.headers.get("location")).toStartWith(`${redirect}?code=`)
  })

  test("refuses unknown clients and redirect URIs without redirecting", async () => {
    const challenge = pkce().challenge
    const responses = await Promise.all(
      [
        { code_challenge: challenge, client_id: "someone-else" },
        { code_challenge: challenge, redirect_uri: "https://attacker.example/callback" },
      ].map((params) => server.request(authorizeUrl(params))),
    )
    expect(responses.map((response) => response.status)).toEqual([400, 400])
    expect(responses.map((response) => response.headers.get("location"))).toEqual([null, null])
  })

  test("reports a missing PKCE challenge to the client", async () => {
    const response = await server.request(authorizeUrl({ state: "s" }))
    const location = new URL(response.headers.get("location") ?? "")
    expect(location.searchParams.get("error")).toBe("invalid_request")
    expect(location.searchParams.get("state")).toBe("s")
  })
})

describe("token endpoint", () => {
  test("rejects a wrong client secret", async () => {
    const { code, verifier } = await authorizeCode(server)
    const response = await postToken(
      server,
      {
        grant_type: "authorization_code",
        code,
        redirect_uri: HOSTED_CALLBACK,
        code_verifier: verifier,
      },
      basicAuth("not-the-secret"),
    )
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "invalid_client" })
  })

  test("rejects a wrong PKCE verifier and a reused code", async () => {
    const { code, verifier } = await authorizeCode(server)
    const exchange = (codeVerifier: string) =>
      postToken(server, {
        grant_type: "authorization_code",
        code,
        redirect_uri: HOSTED_CALLBACK,
        code_verifier: codeVerifier,
      })
    expect(await (await exchange(pkce().verifier)).json()).toEqual({ error: "invalid_grant" })
    expect(await (await exchange(verifier)).json()).toEqual({ error: "invalid_grant" })
  })

  test("refreshes tokens with client credentials sent in the form", async () => {
    const { refresh_token: refreshToken } = await signIn(server)
    const response = await postToken(
      server,
      {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: "claude",
        client_secret: "test-secret-with-at-least-32-characters",
      },
      "",
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(decodeTokens(await response.json()).token_type).toBe("Bearer")
  })

  test("does not accept an access token as a refresh token", async () => {
    const { access_token: accessToken } = await signIn(server)
    const response = await postToken(server, {
      grant_type: "refresh_token",
      refresh_token: accessToken,
    })
    expect(await response.json()).toEqual({ error: "invalid_grant" })
  })

  test("rejects a forged bearer token on the MCP endpoint", async () => {
    const response = await server.request("/mcp", {
      method: "POST",
      headers: { authorization: "Bearer e30.c2lnbmF0dXJl" },
      body: "{}",
    })
    expect(response.status).toBe(401)
    expect(response.headers.get("www-authenticate")).toStartWith('Bearer error="invalid_token"')
  })
})
