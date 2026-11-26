# ngp-app

An Angular app built by [vite-plugin-ngp](https://push-based.github.io/vite-plugin-ngp/), rendered on the server with `@angular/ssr` and hydrated in the browser. Vite serves it, and ngp compiles each module when it's asked for. The server side is laid out as `ng new --ssr` lays it out.

| Command         | What it does                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| `npm run dev`   | Starts the dev server, which renders every page through `src/server.ts`                                         |
| `npm run build` | Builds the browser bundle into `dist/client` and the server into `dist/server`, type-checking first, then prerenders |
| `npm start`     | Runs the built Express server, `dist/server/server.js`, on port 4000                                             |
| `npm test`      | Runs the specs under Vitest, in Node on the DOM Angular renders with on the server                               |

With Vite+, use `vp dev`, `vp build` and `vp test`.

| File                            | What it's for                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/server.ts`                 | The Express server: static files, then `AngularNodeAppEngine`. Add your API routes here            |
| `src/main.server.ts`            | Bootstraps the app on the server                                                                   |
| `src/app/app.config.server.ts`  | The server's providers, on top of `app.config.ts`                                                  |
| `src/app/app.routes.server.ts`  | How each route renders: `Prerender` at build time, `Server` on each request, or `Client` in the browser |

Every route is prerendered to start with. The server answers only for `localhost`: list your own hosts in `ngp({ ssr: { allowedHosts: [...] } })` in `vite.config.ts`, or in `NG_ALLOWED_HOSTS` when the server starts. The [Server rendering page](https://push-based.github.io/vite-plugin-ngp/server-rendering/) says what the plugin does and doesn't do, and the [status page](https://push-based.github.io/vite-plugin-ngp/status/) lists every limit.

Every `@angular/*` package is pinned to the release the plugin's ngp build was made from. To move Angular, change them all together, to a release the [compatibility page](https://push-based.github.io/vite-plugin-ngp/compatibility/) lists for your plugin version.
