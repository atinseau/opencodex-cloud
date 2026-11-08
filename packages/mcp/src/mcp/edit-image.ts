import { Effect, Schema } from "effect"

import { ImageGeneration } from "../images/index.ts"
import { registerImageTool } from "./image-tool.ts"

const Input = Schema.Struct({
  image_url: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000)).annotate({
    description:
      "Full-resolution PNG link returned by an earlier generate_image or edit_image result, copied exactly.",
  }),
  prompt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4000)).annotate({
    description:
      "The change to make, such as 'replace the sky with a starry night' or 'turn it into a watercolor'. Say what must stay the same.",
  }),
})

/** Registers `edit_image`, which changes an image this connector produced and keeps the original. */
export const registerEditImage = Effect.gen(function* () {
  const images = yield* ImageGeneration
  yield* registerImageTool({
    name: "edit_image",
    title: "Edit image",
    description:
      "Modify an image created earlier in this conversation by generate_image or edit_image, with the ChatGPT image model connected to OpenCodex. Pass the full-resolution link from that result and describe the change; the model keeps the rest of the image and its size. Images uploaded to the conversation and other web links are not supported. Returns a preview and a link to a new full-resolution PNG; the original link stays valid.",
    input: Input,
    outcome: "Edited the image.",
    run: ({ image_url: source, prompt }) => images.edit(source, prompt),
  })
})
