import { Schema } from "effect"

import type { TestServer } from "./harness.ts"
import { signIn } from "./oauth-client.ts"

const ToolResult = Schema.Struct({
  isError: Schema.optional(Schema.Boolean),
  content: Schema.Array(
    Schema.Struct({
      type: Schema.String,
      text: Schema.optional(Schema.String),
      data: Schema.optional(Schema.String),
      mimeType: Schema.optional(Schema.String),
    }),
  ),
})
const RpcResponse = Schema.Struct({
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Struct({ code: Schema.Int, message: Schema.String })),
})
const decodeRpc = Schema.decodeUnknownSync(RpcResponse)
const decodeToolResult = Schema.decodeUnknownSync(ToolResult)

export type ToolResult = typeof ToolResult.Type

export interface McpSession {
  call(method: string, params?: unknown): Promise<typeof RpcResponse.Type>
  callTool(name: string, args: unknown): Promise<ToolResult>
}

/** Signs in through OAuth and opens a session-based MCP 2025-06-18 session over JSON-RPC. */
export const openSession = async (server: TestServer): Promise<McpSession> => {
  const { access_token: token } = await signIn(server)
  let session = ""
  let id = 0
  const call: McpSession["call"] = async (method, params) => {
    id += 1
    const response = await server.request("/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        ...(session === ""
          ? {}
          : { "mcp-session-id": session, "mcp-protocol-version": "2025-06-18" }),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    })
    session = response.headers.get("mcp-session-id") ?? session
    return decodeRpc(await response.json())
  }
  await call("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  })
  return {
    call,
    callTool: async (name, args) =>
      decodeToolResult((await call("tools/call", { name, arguments: args })).result),
  }
}

/** The full-resolution link announced in an image tool result. */
export const linkIn = (result: ToolResult): string =>
  /http:\/\/\S+\/mcp\/images\/[\w-]{43}\.png/u.exec(result.content[1]?.text ?? "")?.[0] ?? ""
