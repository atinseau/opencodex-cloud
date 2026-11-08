import { Option } from "effect"

import type { PublicEndpoint } from "../config.ts"

/** Download link of a stored image. The 256-bit identifier makes the link its own authorization. */
export const imageUrl = (endpoint: PublicEndpoint, id: string): string =>
  `${endpoint.url}/images/${id}.png`

const STORED_FILE = /^([\w-]{43})(?:\.png)?$/u

/**
 * Image id behind a download link this connector produced, or behind its bare file name. Any
 * other URL resolves to nothing: the connector never fetches images from elsewhere.
 */
export const storedIdOf = (endpoint: PublicEndpoint, reference: string): Option.Option<string> => {
  const trimmed = reference.trim()
  const prefix = `${endpoint.url}/images/`
  const file = trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed
  return Option.fromNullishOr(STORED_FILE.exec(file)?.[1])
}
