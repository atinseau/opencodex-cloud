import { Context, Effect, Layer, Schema } from "effect"
import { McpSchema, McpServer } from "effect/ai"

import { ImageGeneration } from "../images/index.ts"
import type { GeneratedImage } from "../images/index.ts"

const Input = Schema.Struct({
  prompt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4000)).annotate({
    description:
      "Detailed description of the image to create: subject, composition, style, lighting and any text to render.",
  }),
})
const decodeInput = Schema.decodeUnknownEffect(Input, { onExcessProperty: "error" })

const describe = (image: GeneratedImage) =>
  [
    `Generated a ${image.width}×${image.height} preview of the image.`,
    `Full-resolution PNG: ${image.downloadUrl}`,
    `The link stays valid for ${image.retainedFor}. Share it with the user so they can download the image.`,
  ].join("\n")

const toolResult = (image: GeneratedImage) =>
  new McpSchema.CallToolResult({
    content: [
      { type: "image", data: image.preview, mimeType: "image/jpeg" },
      { type: "text", text: describe(image) },
    ],
  })

/** Registers `generate_image`, which returns the image itself plus a full-resolution link. */
export const GenerateImageTool = Layer.effectDiscard(
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer
    const images = yield* ImageGeneration
    const inputSchema = yield* Schema.decodeUnknownEffect(McpSchema.ToolJson)(
      Schema.toJsonSchemaDocument(Input, { onExcessProperty: "error" }).schema,
    ).pipe(Effect.orDie)

    yield* server.addTool({
      tool: new McpSchema.Tool({
        name: "generate_image",
        title: "Generate image",
        description:
          "Create a new image from a text prompt with the ChatGPT image model connected to OpenCodex. Returns a preview and a link to the full-resolution PNG.",
        inputSchema,
        annotations: {
          title: "Generate image",
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
          Effect.flatMap(({ prompt }) => images.create(prompt)),
          Effect.map(toolResult),
          Effect.catchTag("ImageGenerationError", ({ message }) =>
            Effect.succeed(
              new McpSchema.CallToolResult({
                isError: true,
                content: [{ type: "text", text: message }],
              }),
            ),
          ),
        ),
    })
  }),
)
