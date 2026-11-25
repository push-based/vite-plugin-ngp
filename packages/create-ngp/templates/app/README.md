# ngp-app

An Angular app built by [vite-plugin-ngp](https://push-based.github.io/vite-plugin-ngp/): Vite serves it, and ngp compiles each module when the browser asks for it.

| Command           | What it does                                                                       |
| ----------------- | ---------------------------------------------------------------------------------- |
| `npm run dev`     | Starts the dev server. Template and style edits update the page in place           |
| `npm run build`   | Builds the app into `dist/`, type-checking it first                                |
| `npm run preview` | Serves `dist/`                                                                     |
| `npm test`        | Runs the specs under Vitest, in Node on the DOM Angular renders with on the server |

With Vite+, use `vp dev`, `vp build`, `vp preview` and `vp test`.

Every `@angular/*` package is pinned to the release the plugin's ngp build was made from. To move Angular, change them all together, to a release the [compatibility page](https://push-based.github.io/vite-plugin-ngp/compatibility/) lists for your plugin version. The [status page](https://push-based.github.io/vite-plugin-ngp/status/) lists what works and what doesn't.
