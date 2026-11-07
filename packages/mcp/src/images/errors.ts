import { Schema } from "effect"

/** A generation the hub refused or could not complete. The message is safe to show to Claude. */
export class ImageGenerationError extends Schema.TaggedError<
  ImageGenerationError,
  { readonly brand: unique symbol }
>()("ImageGenerationError", { message: Schema.String }) {}
