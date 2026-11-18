# ngp-app

An Angular app built by [vite-plugin-ngp](https://push-based.github.io/vite-plugin-ngp/), rendered on the server and hydrated in the browser. Vite serves it, and ngp compiles each module when it's asked for.

| Command         | What it does                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| `npm run dev`   | Starts the dev server, which renders every page with `src/main.server.ts`                                  |
| `npm run build` | Builds the browser bundle into `dist/client` and the server bundle into `dist/server`, type-checking first |
| `npm start`     | Serves the build with `server.mjs` on port 4000, rendering each page on the server                         |
| `npm test`      | Runs the specs under Vitest, in Node on the DOM Angular renders with on the server                         |

With Vite+, use `vp dev`, `vp build` and `vp test`. `server.mjs` is plain Node: run it with `node server.mjs`.

`server.mjs` renders only URLs on `localhost`: add your own hosts to `allowedHosts` in `src/main.server.ts`. The [Server rendering page](https://push-based.github.io/vite-plugin-ngp/server-rendering/) says what the plugin does and doesn't do, and the [status page](https://push-based.github.io/vite-plugin-ngp/status/) lists every limit.

Every `@angular/*` package is pinned to one exact version, the release the plugin's ngp build was made from. Upgrade them together with the plugin, never on their own.
