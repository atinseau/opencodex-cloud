import { Effect, Schema } from "effect"
import { McpSchema } from "effect/ai"

import { MAX_IMAGES_PER_CALL } from "../images/index.ts"
import type { GeneratedImage, ImageGenerationError } from "../images/index.ts"
import { registerTool, toolError } from "./tool.ts"
import type { ToolInput } from "./tool.ts"

/** 1 to `MAX_IMAGES_PER_CALL` links to images stored by this connector. */
export const ImageLinks = Schema.Array(
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000)),
).check(Schema.isMinLength(1), Schema.isMaxLength(MAX_IMAGES_PER_CALL))

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

/**
 * Registers a tool that produces an image through ChatGPT. Its result is the preview itself plus
 * a link to the full PNG; refusals from the hub become tool errors Claude can explain.
 */
export const registerImageTool = <Input extends ToolInput>(options: ImageToolOptions<Input>) =>
  registerTool({
    name: options.name,
    title: options.title,
    description: options.description,
    input: options.input,
    readOnly: false,
    run: (input) =>
      options.run(input).pipe(
        Effect.map((image) => toolResult(options.outcome, image)),
        Effect.catchTag("ImageGenerationError", toolError),
      ),
  })
