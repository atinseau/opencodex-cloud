import { Layer } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"

import { Images } from "./images/index.ts"
import { Mcp } from "./mcp/index.ts"
import { OAuth } from "./oauth/index.ts"

const Health = HttpRouter.add("GET", "/healthz", HttpServerResponse.text("ok"))

/** Every route of the connector. The HTTP server, client and platform services come from the host. */
export const App = Layer.mergeAll(Health, OAuth, Mcp.pipe(Layer.provide(Images)), Images)
