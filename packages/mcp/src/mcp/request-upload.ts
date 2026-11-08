import { Effect, Schema } from "effect"
import { McpSchema } from "effect/ai"

import { ImageUploads } from "../images/index.ts"
import type { UploadRequest } from "../images/index.ts"
import { registerTool } from "./tool.ts"

/** No arguments: `Struct({})` would accept any value, this accepts only an empty object. */
const NoInput = Schema.Record(Schema.String, Schema.Never)

const describe = (upload: UploadRequest) =>
  [
    `Upload link for the user: ${upload.uploadUrl}`,
    `It works once and expires in ${upload.expiresIn}. Give it to the user and ask them to upload the image there, then wait for them to confirm.`,
    `Once they confirm, pass this link to edit_image in image_urls: ${upload.imageUrl}`,
    "Until the upload is done, edit_image reports that image as unknown.",
  ].join("\n")

/** Registers `request_image_upload`, which brings an image from the user's device to edit_image. */
export const registerRequestImageUpload = Effect.gen(function* () {
  const uploads = yield* ImageUploads
  yield* registerTool({
    name: "request_image_upload",
    title: "Request image upload",
    description:
      "Create a one-time link where the user uploads an image from their device so that edit_image can modify it. Tools cannot receive images attached to the conversation: when the user wants to edit such an image, or any image that generate_image and edit_image did not produce, call this tool, give the link to the user and wait for them to confirm the upload. The result also gives the image link to pass to edit_image afterwards.",
    input: NoInput,
    readOnly: true,
    run: () =>
      Effect.map(
        uploads.request,
        (upload) =>
          new McpSchema.CallToolResult({ content: [{ type: "text", text: describe(upload) }] }),
      ),
  })
})
