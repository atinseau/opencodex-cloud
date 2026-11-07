import { Clock, Context, Crypto, Effect, Layer, Option, Ref } from "effect"
import * as Base64Url from "effect/encoding/Base64Url"

const CODE_LIFETIME_MILLIS = 60_000

export interface AuthorizationGrant {
  readonly redirectUri: string
  readonly codeChallenge: string
}

interface PendingGrant extends AuthorizationGrant {
  readonly expiresAt: number
}

/** Short-lived, single-use authorization codes kept in memory. */
export class AuthorizationCodes extends Context.Service<
  AuthorizationCodes,
  {
    issue(grant: AuthorizationGrant): Effect.Effect<string>
    redeem(code: string): Effect.Effect<Option.Option<AuthorizationGrant>>
  }
>()("opencodex-cloud/mcp/oauth/AuthorizationCodes") {
  static readonly layer = Layer.effect(
    AuthorizationCodes,
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto
      const pending = yield* Ref.make<ReadonlyMap<string, PendingGrant>>(new Map())

      const issue = Effect.fn("AuthorizationCodes.issue")(function* (grant: AuthorizationGrant) {
        const code = Base64Url.encode(yield* Effect.orDie(crypto.randomBytes(32)))
        const now = yield* Clock.currentTimeMillis
        yield* Ref.update(pending, (current) => {
          const next = new Map([...current].filter(([, entry]) => entry.expiresAt > now))
          return next.set(code, { ...grant, expiresAt: now + CODE_LIFETIME_MILLIS })
        })
        return code
      })

      const redeem = Effect.fn("AuthorizationCodes.redeem")(function* (code: string) {
        const now = yield* Clock.currentTimeMillis
        return yield* Ref.modify(pending, (current) => {
          const next = new Map(current)
          const entry = Option.fromNullishOr(next.get(code))
          next.delete(code)
          return [Option.filter(entry, (grant) => grant.expiresAt > now), next] as const
        })
      })

      return AuthorizationCodes.of({ issue, redeem })
    }),
  )
}
