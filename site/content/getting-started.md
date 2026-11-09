---
title: Getting started
description: Install @push-based/vite-plugin-ngp from npm and serve your Angular app with Vite.
---

# Getting started

This page takes you from an Angular app to the same app served by Vite through vite-plugin-ngp. Plan on about five minutes. You'll need to pin exact Angular versions, because the ngp build inside the package only works with the Angular release it was built from.

## What you need

| | |
|---|---|
| Operating system | macOS (arm64 or x64) or Linux with glibc (x64 or arm64), WSL 2 included. Anywhere else, Alpine included, set `engine: 'wasm'` ([Configuration](configuration)). Windows itself is untested |
| Node | 26 |
| Angular | Exactly `22.3.0-next.4` |

You don't need Rust or a clone of the repo. Angular hasn't published ngp, so the package carries its own build of it, made from Angular's source at the commit behind `22.3.0-next.4`, with a native engine for each platform above.

## 1. Install the plugin

```bash
npm install -D @push-based/vite-plugin-ngp vite@8.3.4
```

With pnpm, `pnpm add -D` takes the same two packages.

> [!WARNING]
> Pin every `@angular/*` package to exactly `22.3.0-next.4`, the release built from the same commit as ngp. Any other version fails, because ngp imports private APIs from `@angular/compiler-cli`.

```json title="package.json"
{
  "dependencies": {
    "@angular/common": "22.3.0-next.4",
    "@angular/compiler": "22.3.0-next.4",
    "@angular/core": "22.3.0-next.4",
    "@angular/platform-browser": "22.3.0-next.4",
    "@angular/router": "22.3.0-next.4"
  },
  "devDependencies": {
    "@angular/compiler-cli": "22.3.0-next.4",
    "typescript": "6.0.3"
  }
}
```

## 2. Add the plugin to Vite

```ts title="vite.config.ts"
import {defineConfig} from 'vite';
import {ngp} from '@push-based/vite-plugin-ngp';

export default defineConfig({
  plugins: [ngp()],
});
```

`ngp()` needs no options. It loads the ngp build inside the package. [Configuration](configuration) lists what you can change.

## 3. Point Vite at your app

Vite starts from `index.html`, not from `angular.json`. Put one in your project root that loads `src/main.ts`:

```html title="index.html"
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>My app</title>
  </head>
  <body>
    <app-root></app-root>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

Keep `main.ts` as `ng new` wrote it:

```ts title="src/main.ts"
import {bootstrapApplication} from '@angular/platform-browser';
import {App} from './app/app';
import {appConfig} from './app/app.config';

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
```

> [!NOTE]
> Don't import `@angular/compiler`. The plugin links Angular's libraries ahead of time, so the browser never needs the JIT compiler, and importing it adds the whole compiler to your bundle.

The plugin reads `tsconfig.app.json`, or `tsconfig.json` if that doesn't exist, for your Angular compiler options. Then run:

```bash
pnpm vite
```

For a production build, run `pnpm vite build`. The output in `dist/` is a static site you can serve from any file host.

## Next

- [How it works](how-it-works) explains what happens between Vite's request and the compiled module.
- [Configuration](configuration) lists every option.
- [Migrating from ng build](migrating-from-ng-build) says where each angular.json build option goes, if you're moving an existing app.
- [Status and limits](status) says what doesn't work yet. Read it before you try a large app.
