---
title: Using Vite+
description: Start an Angular app on vite-plugin-ngp with vp create @push-based/ngp, move an existing one with vp migrate, and what vp check, vp test and the rest do with Angular.
---

# Using Vite+

[Vite+](https://viteplus.dev) is one command, `vp`, over Vite, Vitest, Oxlint, Oxfmt and a package manager. For an Angular app on this plugin it changes three things: you run `vp dev`, `vp build` and `vp test` instead of `vite` and `vitest`; config files and specs import from `vite-plus` and `vite-plus/test`; and the `vite` package in `node_modules` is Vite+'s own build of Vite, `@voidzero-dev/vite-plus-core`, under the name `vite`. The plugin runs on it unchanged. Everything on this page was checked with Vite+ 1.6.0 on macOS with Node 26, on 16 November 2026.

## Create a new app

```bash
vp create @push-based/ngp
```

vp downloads `@push-based/create-ngp` from npm and runs it. It asks for a directory and a template, and writes the app. Then vp does its own setup: `git init`, an `AGENTS.md`, pre-commit hooks, the install, and a format pass. When it's done:

```bash
cd ngp-app
```

```bash
vp dev
```

Without Vite+, the same scaffolder runs through npm, pnpm, yarn or bun:

```bash
npm create @push-based/ngp@latest
```

That writes the files and stops: no install, no `git init`. It prints the commands to run next. The app is a plain Vite project, the one [Getting started](getting-started) describes, with a spec and the [server-platform test setup](testing#setup-node-on-the-server-platform).

### Pass the directory and the template

vp passes the scaffolder only what comes after `--`. A directory written before it is an error in 1.6.0:

```bash
vp create @push-based/ngp -- my-app --template app-ssr
```

To run without a single prompt, in CI say, both need telling. vp's `--no-interactive` goes before `--` and the scaffolder's after, because vp doesn't pass its own on:

```bash
vp create @push-based/ngp --no-interactive -- my-app --no-interactive --template app
```

| Option | What it does |
|---|---|
| `[directory]` | Where to write the app. Asked for when missing, `ngp-app` without a prompt. The package name comes from its last segment |
| `-t, --template <name>` | `app` or `app-ssr`. Asked for when missing, `app` without a prompt |
| `--overwrite` | Empties a directory that isn't empty. Without it, the scaffolder asks, or stops when it can't ask. A `.git` folder is kept either way |
| `--interactive`, `--no-interactive` | Whether to ask. The default is to ask when run in a terminal |
| `-h, --help` | Lists the options |

## The templates

Both are what `ng new` would give you, on Vite: standalone components, zoneless, strict templates, one lazy route, and `ng new`'s tsconfig files.

| | `app` | `app-ssr` |
|---|---|---|
| Renders | In the browser | On the server, then hydrates in the browser |
| Plugin options | `ngp()` | `ngp({ ssr: true })` |
| Extra files | | `ng new --ssr`'s files, as [Server rendering](server-rendering#with-angular-ssr) describes them: `src/server.ts`, an Express server on `@angular/ssr`, `src/main.server.ts`, `app.config.server.ts` and `app.routes.server.ts` |
| Scripts | `dev`, `build`, `preview`, `test` | `dev`, `build`, `start`, `test` |
| Spec | `src/app/app.spec.ts`, under Vitest in Node on Domino | The same |

Every `@angular/*` package is pinned to `22.3.0-rc.0`, the release the plugin's ngp build was made from, and the plugin to the scaffolder's own version: `@push-based/create-ngp` and the plugin are released together, at the same version. You can move Angular to any release the plugin accepts, all `@angular/*` packages together: [Compatibility](compatibility) lists them.

Each template also has a `pnpm-workspace.yaml` that only pnpm reads. The plugin depends on esbuild, which has an install script it doesn't need, and pnpm 11 and later stop the install over a build script nobody approved or denied; Vite+ 1.6.0 installs with pnpm 12. The file denies the script, so the install goes through. npm, yarn and bun ignore the file, and you can delete it if you don't use pnpm.

## What vp changes after the template

The scaffolder writes a plain Vite project, and then vp rewrites it the way `vp migrate` rewrites any Vite project. You'll find:

- `vite-plus` in `devDependencies`, and `vite` pointing at `@voidzero-dev/vite-plus-core` through a pnpm catalog and an override in `pnpm-workspace.yaml`.
- Scripts that call `vp dev`, `vp build`, `vp preview` and `vp test run`, plus `"prepare": "vp config"`.
- Imports from `vite-plus` in `vite.config.ts` and `vitest.config.ts`, and from `vite-plus/test` in the spec and the setup file. `vitest` leaves `devDependencies`.
- `plugins: lazyPlugins(() => [ngp()])`, and `fmt`, `lint` and `staged` blocks, in `vite.config.ts`.
- `AGENTS.md`, `.vite-hooks/`, and a format pass with Oxfmt's defaults.

Two of these are worth knowing about:

**Keep `vite` in `package.json`.** The plugin imports from `vite`, so it needs a package by that name. vp's rewrite points `vite` at Vite+'s build only when the project already declares `vite`, which is why the template does. A Vite+ project with no `vite` entry fails to load the plugin.

**Oxfmt's defaults use double quotes.** The template is written in Angular's style, single quotes, and the format pass turns them into double quotes. To keep single quotes, set it in `vite.config.ts` and format again:

```ts title="vite.config.ts"
export default defineConfig({
  fmt: { singleQuote: true },
  // ...
});
```

```bash
vp fmt
```

## Move an existing app to Vite+

An app set up as [Getting started](getting-started) describes moves with one command, in its root:

```bash
vp migrate
```

It makes the rewrite listed above: `vite-plus` added, `vite` aliased, scripts and imports changed, `lazyPlugins`, and the `fmt`, `lint` and `staged` blocks. Your `vitest.config.ts` stays, with its import changed to `vite-plus`. Then:

1. **Check that `vite` is still in `package.json`**, as `npm:@voidzero-dev/vite-plus-core@<version>` or through `catalog:`. Getting started has you install `vite`, so it is, unless you removed it.
2. **With pnpm 11 or later, deny esbuild's install script** if the install stops at "Ignored build scripts: esbuild". Vite+ 1.6.0 installs with pnpm 12. In `pnpm-workspace.yaml`:

   ```yaml title="pnpm-workspace.yaml"
   allowBuilds:
     esbuild: false
   ```

   Then run `vp install` again. esbuild comes with the plugin, which doesn't need the script.
3. **Format once:** `vp check --fix`. `vp migrate` doesn't format, and Oxfmt's defaults differ from Angular's style, so `vp check` fails on formatting until you do. Set `fmt.singleQuote` first if you want to keep single quotes.
4. **Run `vp build` and `vp test`.**

With npm, `vp migrate` writes the alias as an `overrides` entry in `package.json`, and the install accepts it with no peer warning. With pnpm it goes in `pnpm-workspace.yaml`, with a `peerDependencyRules` entry that lets the alias stand in for `vite`.

### From ng build

Move the app off `ng build` first, with [Migrating from ng build](migrating-from-ng-build), then run `vp migrate` on the Vite project that leaves you. `vp migrate` converts Vite and Vitest projects, so it can't do the first step for you. Nobody has yet run it on an app that still has `angular.json`; delete that, and the `ng` scripts, once nothing uses them. If you use Husky, it stays: Vite+'s [migration guide](https://viteplus.dev/guide/migrate) says `vp migrate` leaves Husky's hooks, scripts and dependencies unchanged and warns, and you move them to its `.vite-hooks` by hand.

## The toolchain with Angular

| Command | What it does with an Angular app |
|---|---|
| `vp dev`, `vp build`, `vp preview` | Run Vite+'s Vite with the plugin, exactly as `vite` does. The plugin's type-check runs in both, and its errors fail `vp build` |
| `vp test` | Runs Vitest 5.1, bundled with Vite+ 1.6.0. Specs and the setup file import from `vite-plus/test`; the [setup](testing#setup-node-on-the-server-platform) is otherwise unchanged |
| `vp check` | Formats with Oxfmt, lints with Oxlint, and type-checks `.ts` files with TypeScript 7. It doesn't check templates: a misspelled property in `app.html` passes `vp check` and fails `vp build`, from the plugin's check |
| `vp lint`, `vp fmt` | The lint and format halves of `vp check`, on their own. Oxlint has no Angular rules; decorators and signals lint clean |
| `vpx ngp-extract-i18n` | Extracts messages, as `ngp-extract-i18n` does. The `i18n` option's per-locale build works under `vp build` |

## Server rendering under Vite+

Nothing changes. With `ngp({ ssr: true })`, `vp dev` renders every page on the server, and `vp build` writes `dist/client` and `dist/server`, as [Server rendering](server-rendering) describes. In the `app-ssr` template, `vp build` also prerenders, and `node dist/server/server.js` runs the built Express server.

## Limits

- **The command is `vp create @push-based/ngp`.** A bare `vp create ngp` resolves to another package name, and the template isn't in `vp create --list`. Both need a change in Vite+ itself.
- **pnpm 11 and later report an unmet `typescript` peer.** The plugin depends on TypeScript 7 for its type-check, as an alias, and pnpm counts that as the plugin's TypeScript. The plugin parses with the TypeScript `@angular/compiler-cli` uses, your TypeScript 6, so the warning is harmless. In 0.4.0 and earlier it wasn't: under pnpm 11 and later the plugin loaded TypeScript 7 there, so a template error made `vp build` fail with "Cannot read properties of undefined (reading 'Latest')" instead of the error, and so did a `.ts` edit in `vp dev`.
- **Not tried under Vite+:** Nx workspaces, Vitest's browser mode and jsdom, and `vp pack`, which builds libraries; the plugin [compiles apps only](status).
- **Windows is untested,** with Vite+ as without it.
