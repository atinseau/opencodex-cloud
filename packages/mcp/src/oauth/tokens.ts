import { Clock, Context, Effect, Layer, Option, Redacted, Result, Schema } from "effect"
import * as Base64Url from "effect/encoding/Base64Url"

import { constantTimeEqual, hmacSha256 } from "../crypto.ts"
import { OAuthSettings } from "./settings.ts"

const ACCESS_TOKEN_SECONDS = 60 * 60
const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60

const TokenType = Schema.Literals(["access", "refresh"])
type TokenType = typeof TokenType.Type

const Claims = Schema.Struct({
  typ: TokenType,
  sub: Schema.String,
  aud: Schema.String,
  exp: Schema.Int,
})
type Claims = typeof Claims.Type

const decodeClaims = Schema.decodeUnknownOption(Schema.fromJsonString(Claims))
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export interface TokenPair {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresIn: number
}

/**
 * Issues and verifies stateless HMAC-signed tokens. The signing key derives from the client secret,
 * so rotating the secret revokes every token at once.
 */
export class Tokens extends Context.Service<
  Tokens,
  {
    readonly issue: Effect.Effect<TokenPair>
    verify(token: string, type: TokenType): Effect.Effect<boolean>
  }
>()("opencodex-cloud/mcp/oauth/Tokens") {
  static readonly layer = Layer.effect(
    Tokens,
    Effect.gen(function* () {
      const settings = yield* OAuthSettings
      const key = hmacSha256(Redacted.value(settings.clientSecret), "opencodex-cloud-mcp/tokens/v1")
      const signature = (payload: string) => Base64Url.encode(hmacSha256(key, payload))
      const sign = (claims: Claims) => {
        const payload = Base64Url.encode(encoder.encode(JSON.stringify(claims)))
        return `${payload}.${signature(payload)}`
      }
      const claimsOf = (token: string): Option.Option<Claims> => {
        const [payload = "", tokenSignature = "", ...rest] = token.split(".")
        if (rest.length > 0 || !constantTimeEqual(signature(payload), tokenSignature)) {
          return Option.none()
        }
        return Option.flatMap(Result.getSuccess(Base64Url.decode(payload)), (bytes) =>
          decodeClaims(decoder.decode(bytes)),
        )
      }
      const now = Effect.map(Clock.currentTimeMillis, (millis) => Math.floor(millis / 1000))
      const subject = { sub: settings.clientId, aud: settings.resource }

      return Tokens.of({
        issue: Effect.map(now, (seconds) => ({
          accessToken: sign({ ...subject, typ: "access", exp: seconds + ACCESS_TOKEN_SECONDS }),
          refreshToken: sign({ ...subject, typ: "refresh", exp: seconds + REFRESH_TOKEN_SECONDS }),
          expiresIn: ACCESS_TOKEN_SECONDS,
        })),
        verify: (token, type) =>
          Effect.map(now, (seconds) =>
            Option.match(claimsOf(token), {
              onNone: () => false,
              onSome: (claims) =>
                claims.typ === type &&
                claims.sub === subject.sub &&
                claims.aud === subject.aud &&
                claims.exp > seconds,
            }),
          ),
      })
    }),
  )
}
