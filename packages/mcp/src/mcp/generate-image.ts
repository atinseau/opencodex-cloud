import { Effect, Schema } from "effect"

import { ImageGeneration } from "../images/index.ts"
import { registerImageTool } from "./image-tool.ts"

const Input = Schema.Struct({
  prompt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4000)).annotate({
    description:
      "Detailed description of the image to create: subject, composition, style, lighting and any text to render.",
  }),
})

/** Registers `generate_image`, which creates a new image from a text prompt. */
export const registerGenerateImage = Effect.gen(function* () {
  const images = yield* ImageGeneration
  yield* registerImageTool({
    name: "generate_image",
    title: "Generate image",
    description:
      "Create a new image from a text prompt with the ChatGPT image model connected to OpenCodex. Returns a preview and a link to the full-resolution PNG.",
    input: Input,
    outcome: "Generated the image.",
    run: ({ prompt }) => images.create(prompt),
  })
})
