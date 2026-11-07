import { BunHttpServer, BunRuntime, BunServices } from "@effect/platform-bun"
import { Config, Layer } from "effect"
import { FetchHttpClient, HttpRouter } from "effect/http"

import { App } from "./app.ts"

const Server = HttpRouter.serve(App).pipe(
  Layer.provide(
    BunHttpServer.layerConfig({ port: Config.Port("PORT").pipe(Config.withDefault(8080)) }),
  ),
  Layer.provide(Layer.mergeAll(FetchHttpClient.layer, BunServices.layer)),
)

BunRuntime.runMain(Layer.launch(Server))
