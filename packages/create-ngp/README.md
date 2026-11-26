# @push-based/create-ngp

Scaffolds an Angular app built by [vite-plugin-ngp](https://push-based.github.io/vite-plugin-ngp/), which lets Vite compile Angular one module at a time with ngp.

```bash
npm create @push-based/ngp@latest
```

With [Vite+](https://viteplus.dev):

```bash
vp create @push-based/ngp
```

It asks for a directory and a template, writes the app, and prints what to run next. It doesn't install anything or run `git init`; under Vite+, `vp create` does both afterwards.

| Template | What you get |
|---|---|
| `app` | An app rendered in the browser, with routing and a Vitest spec that runs in Node on the server platform's DOM |
| `app-ssr` | `app`, plus rendering on the server with `@angular/ssr` and hydration, laid out like `ng new --ssr`: an Express `src/server.ts`, `src/main.server.ts`, server routes, and prerendering in `vite build` |

```text
create-ngp [directory] [--template app|app-ssr] [--overwrite] [--no-interactive]
```

Under Vite+, put the scaffolder's options after `--`: `vp create @push-based/ngp -- my-app --template app-ssr`. [Using Vite+](https://push-based.github.io/vite-plugin-ngp/vite-plus/) has the details, and the [status page](https://push-based.github.io/vite-plugin-ngp/status/) says what the plugin does and doesn't do yet.

The app pins `@push-based/vite-plugin-ngp` at this package's version, which is released together with it, and every `@angular/*` package at the Angular release the plugin's ngp build came from. The app can move to any Angular the plugin accepts: see the [compatibility page](https://push-based.github.io/vite-plugin-ngp/compatibility/).

## License

MIT
