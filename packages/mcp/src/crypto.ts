const sha256 = (data: string): Uint8Array => new Bun.CryptoHasher("sha256").update(data).digest()

const equalBytes = (left: Uint8Array, right: Uint8Array): boolean => {
  let difference = left.length ^ right.length
  for (const [index, byte] of left.entries()) {
    difference |= byte ^ (right[index] ?? 0)
  }
  return difference === 0
}

/** Compares two secrets in constant time with respect to their content and length. */
export const constantTimeEqual = (left: string, right: string): boolean =>
  equalBytes(sha256(left), sha256(right))

export const hmacSha256 = (key: string | Uint8Array, data: string): Uint8Array =>
  new Bun.CryptoHasher("sha256", key).update(data).digest()
