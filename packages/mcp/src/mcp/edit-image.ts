import { Effect, Schema } from "effect"

import { ImageGeneration, MAX_IMAGES_PER_CALL } from "../images/index.ts"
import { ImageLinks, registerImageTool } from "./image-tool.ts"

const Input = Schema.Struct({
  image_urls: ImageLinks.annotate({
    description: `1 to ${MAX_IMAGES_PER_CALL} image links returned by generate_image, edit_image or request_image_upload, copied exactly. The first image is the one to modify; the others are references the prompt can draw from, such as an object, a person or a style.`,
  }),
  prompt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4000)).annotate({
    description:
      "The change to make, such as 'replace the sky with a starry night'. With several images, refer to them by position, such as 'the cat from the second image'. Say what must stay the same.",
  }),
})

/** Registers `edit_image`, which changes or combines stored images and keeps the originals. */
export const registerEditImage = Effect.gen(function* () {
  const images = yield* ImageGeneration
  yield* registerImageTool({
    name: "edit_image",
    title: "Edit image",
    description:
      "Modify an image, or combine several, with the ChatGPT image model connected to OpenCodex. Every image must come from generate_image, edit_image or request_image_upload: pass the image links from those results and describe the change. If you have not seen an image in this conversation, such as a pasted link or an upload, call view_image first so the prompt matches its content and style. The first image is the one modified, and the result keeps its size and framing; the others are references, as in 'put the cat from the second image on the chair in the first'. Images attached to the conversation cannot be passed directly: call request_image_upload first, once per image. Returns a preview and a link to a new full-resolution PNG; the original links stay valid.",
    input: Input,
    outcome: "Edited the image.",
    run: ({ image_urls: sources, prompt }) => images.edit(sources, prompt),
  })
})
