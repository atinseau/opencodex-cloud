import { Effect, Option, Schema } from "effect"
import { HttpRouter, HttpServerRequest } from "effect/http"
import type { HttpServerResponse } from "effect/http"

import { publicEndpoint } from "../config.ts"

const JsonRpcError = Schema.fromJsonString(
  Schema.Struct({ error: Schema.Struct({ message: Schema.String }) }),
)
const decodeError = Schema.decodeUnknownOption(JsonRpcError)
const decoder = new TextDecoder()

const errorMessage = (response: HttpServerResponse.HttpServerResponse): string =>
  response.body._tag === "Uint8Array"
    ? Option.match(decodeError(decoder.decode(response.body.body)), {
        onNone: () => "none",
        onSome: ({ error }) => error.message,
      })
    : "none"

/**
 * Logs the transport metadata of every MCP request: negotiated protocol version, method header,
 * session presence, status and JSON-RPC error. Request bodies and credentials are never logged.
 */
export const McpRequestLog = HttpRouter.middleware(
  Effect.gen(function* () {
    const { path } = yield* publicEndpoint
    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const response = yield* httpEffect
        if (request.url.split("?", 1)[0] === path && request.method !== "GET") {
          yield* Effect.logInfo("MCP request").pipe(
            Effect.annotateLogs({
              status: response.status,
              protocolVersion: request.headers["mcp-protocol-version"] ?? "none",
              method: request.headers["mcp-method"] ?? "none",
              session: request.headers["mcp-session-id"] === undefined ? "absent" : "present",
              error: errorMessage(response),
            }),
          )
        }
        return response
      })
  }),
  { global: true },
)
