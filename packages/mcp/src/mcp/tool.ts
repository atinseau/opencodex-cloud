import { Context, Effect, Schema } from "effect"
import { McpSchema, McpServer } from "effect/ai"

export type ToolInput = Schema.ConstraintCodec<unknown, unknown, never, unknown>

export interface ToolOptions<Input extends ToolInput> {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly input: Input
  /** Tools that call ChatGPT are neither read-only nor closed-world. */
  readonly readOnly: boolean
  readonly run: (input: Input["Type"]) => Effect.Effect<McpSchema.CallToolResult>
}

/** Registers a tool whose arguments are decoded with `input`, which also publishes its schema. */
export const registerTool = Effect.fn("registerTool")(function* <Input extends ToolInput>(
  options: ToolOptions<Input>,
) {
  const server = yield* McpServer.McpServer
  const decodeInput = Schema.decodeUnknownEffect(options.input, { onExcessProperty: "error" })
  const inputSchema = yield* Schema.decodeUnknownEffect(McpSchema.ToolJson)(
    Schema.toJsonSchemaDocument(options.input, { onExcessProperty: "error" }).schema,
  ).pipe(Effect.orDie)

  yield* server.addTool({
    tool: new McpSchema.Tool({
      name: options.name,
      title: options.title,
      description: options.description,
      inputSchema,
      annotations: {
        title: options.title,
        readOnlyHint: options.readOnly,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: !options.readOnly,
      },
    }),
    annotations: Context.empty(),
    handle: (payload) =>
      decodeInput(payload ?? {}).pipe(
        Effect.mapError((error) => new McpSchema.InvalidParams({ message: error.message })),
        Effect.flatMap(options.run),
      ),
  })
})

/** A refusal Claude can explain to the user, such as an unknown image or a hub error. */
export const toolError = ({ message }: { readonly message: string }) =>
  Effect.succeed(
    new McpSchema.CallToolResult({ isError: true, content: [{ type: "text", text: message }] }),
  )
