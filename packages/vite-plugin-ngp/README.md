# vite-plugin-ngp

Vite plugin that compiles Angular one module at a time with ngp, the Rust-and-TypeScript preprocessor Angular merged on 8 October 2026. Vite asks for each file when the browser needs it, and no whole-program compile runs first.

**Docs: https://push-based.github.io/vite-plugin-ngp/**

## Before you install

Angular hasn't published ngp, so this package carries its own build of it, from Angular's source at the commit behind `22.3.0-next.4`. It has native engines for macOS (arm64, x64) and glibc Linux (x64, arm64). Anywhere else, Alpine included, set `engine: 'wasm'`. Every `@angular/*` package must be exactly `22.3.0-next.4`, because ngp uses private APIs of the compiler it was built with.

```ts
import {defineConfig} from 'vite';
import {ngp} from '@push-based/vite-plugin-ngp';

export default defineConfig({
  plugins: [ngp()],
});
```

The ngp build is unofficial: the Angular team doesn't publish or support it. `ngp/BUILD.json` names the Angular commit, and `ngp/LICENSE` is Angular's MIT licence.

The [status page](https://push-based.github.io/vite-plugin-ngp/status/) lists what works and what doesn't.

## License

MIT. The bundled ngp build is Angular's code, under Angular's MIT licence in `ngp/LICENSE`.
