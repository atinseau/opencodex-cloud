import { Effect, Schema } from "effect"
import { McpSchema } from "effect/ai"

import { ImageGeneration, MAX_IMAGES_PER_CALL } from "../images/index.ts"
import type { ImagePreview } from "../images/index.ts"
import { ImageLinks } from "./image-tool.ts"
import { registerTool, toolError } from "./tool.ts"

const Input = Schema.Struct({
  image_urls: ImageLinks.annotate({
    description: `1 to ${MAX_IMAGES_PER_CALL} image links returned by generate_image, edit_image or request_image_upload, or pasted by the user, copied exactly.`,
  }),
})

const toolResult = (images: ReadonlyArray<ImagePreview>) =>
  new McpSchema.CallToolResult({
    content: images.flatMap((image, index) => [
      {
        type: "text" as const,
        text: `Image ${index + 1}: ${image.url} (preview ${image.width}×${image.height})`,
      },
      { type: "image" as const, data: image.preview, mimeType: "image/jpeg" },
    ]),
  })

/** Registers `view_image`, which shows Claude stored images before it writes an edit prompt. */
export const registerViewImage = Effect.gen(function* () {
  const images = yield* ImageGeneration
  yield* registerTool({
    name: "view_image",
    title: "View image",
    description:
      "Look at images before editing them. Returns a preview of each image link, in order, without calling the image model. Call it before edit_image whenever an image is new to you: a link the user pasted, an image from an earlier conversation, or an upload through request_image_upload. Write the edit prompt from what the previews show, including the style.",
    input: Input,
    readOnly: true,
    run: ({ image_urls: sources }) =>
      images
        .view(sources)
        .pipe(Effect.map(toolResult), Effect.catchTag("ImageGenerationError", toolError)),
  })
})
