import { Context, Effect, Schema } from "effect"
import { McpSchema, McpServer } from "effect/ai"

import type { GeneratedImage, ImageGenerationError } from "../images/index.ts"

type ToolInput = Schema.ConstraintCodec<unknown, unknown, never, unknown>

interface ImageToolOptions<Input extends ToolInput> {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly input: Input
  /** Opening sentence of the result text, such as "Generated the image." */
  readonly outcome: string
  readonly run: (input: Input["Type"]) => Effect.Effect<GeneratedImage, ImageGenerationError>
}

const describe = (outcome: string, image: GeneratedImage) =>
  [
    `${outcome} The preview above is ${image.width}×${image.height}.`,
    `Full-resolution PNG: ${image.downloadUrl}`,
    `The link stays valid for ${image.retainedFor}. Share it with the user so they can download the image, and pass it to edit_image to change this image further.`,
  ].join("\n")

const toolResult = (outcome: string, image: GeneratedImage) =>
  new McpSchema.CallToolResult({
    content: [
      { type: "image", data: image.preview, mimeType: "image/jpeg" },
      { type: "text", text: describe(outcome, image) },
    ],
  })

const toolError = ({ message }: ImageGenerationError) =>
  Effect.succeed(
    new McpSchema.CallToolResult({ isError: true, content: [{ type: "text", text: message }] }),
  )

/**
 * Registers a tool that produces an image. Its result is the preview itself plus a link to the
 * full PNG; refusals from the hub become tool errors Claude can explain to the user.
 */
export const registerImageTool = Effect.fn("registerImageTool")(function* <Input extends ToolInput>(
  options: ImageToolOptions<Input>,
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
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    }),
    annotations: Context.empty(),
    handle: (payload) =>
      decodeInput(payload).pipe(
        Effect.mapError((error) => new McpSchema.InvalidParams({ message: error.message })),
        Effect.flatMap(options.run),
        Effect.map((image) => toolResult(options.outcome, image)),
        Effect.catchTag("ImageGenerationError", toolError),
      ),
  })
})
