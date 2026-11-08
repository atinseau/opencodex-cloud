/** RFC 7636 S256 transformation of a PKCE code verifier. */
export const pkceChallenge = (verifier: string): string =>
  new Bun.CryptoHasher("sha256").update(verifier).digest("base64url")
