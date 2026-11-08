import { Effect, Schema } from "effect"

import { ImageGeneration } from "../images/index.ts"
import { registerImageTool } from "./image-tool.ts"

const Input = Schema.Struct({
  image_url: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000)).annotate({
    description:
      "Image link returned by generate_image, edit_image or request_image_upload, copied exactly.",
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
      "Modify an image with the ChatGPT image model connected to OpenCodex. The image must come from generate_image, edit_image or request_image_upload: pass the image link from that result and describe the change; the model keeps the rest of the image. Images attached to the conversation cannot be passed directly, call request_image_upload first. Returns a preview and a link to a new full-resolution PNG; the original link stays valid.",
    input: Input,
    outcome: "Edited the image.",
    run: ({ image_url: source, prompt }) => images.edit(source, prompt),
  })
})
