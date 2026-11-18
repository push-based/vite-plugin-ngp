# Building vite-plugin-ngp from scratch

This page takes you from a fresh clone to the playground running in your browser. You need it to work on the plugin, not to use it: the npm package carries its own ngp build. Angular hasn't published ngp yet, so the build compiles it from Angular's source first, at the commit pinned in [toolchain/versions.env](../toolchain/versions.env). The first build took about 2 minutes on a 12-core M2 Max, and the whole CI job about 8 minutes on a 2-core GitHub runner with a cold cache, about 2 minutes once the Rust build is cached. Later builds reuse their caches, which take about 1.6 GB of disk.

Everything stays inside the repo. The build installs Rust into `toolchain/.cache/rust` and doesn't touch a Rust you may already have, your `PATH` or your shell profile.

## What you need

| Tool | Version | Check | Install |
|---|---|---|---|
| macOS or Linux | Windows only through WSL 2 | `uname -sm` | |
| Node | 26, pinned in [.nvmrc](../.nvmrc) | `node --version` | `nvm install` in the repo root |
| pnpm | 10 | `pnpm --version` | `corepack enable` |
| git, curl | any recent | `git --version` | your package manager |
| A C compiler | any | `cc --version` | macOS: `xcode-select --install`. Debian or Ubuntu: `sudo apt install build-essential` |

You don't need Rust, Bazel or an Angular checkout. The build fetches what it needs.

## Build it

From the repo root:

```bash
nvm use
```

```bash
pnpm install
```

```bash
pnpm toolchain
```

`pnpm toolchain` runs [toolchain/build.sh](../toolchain/build.sh), which does five things in order:

1. **Checks prerequisites** ([check-prereqs.sh](../toolchain/check-prereqs.sh)). If anything from the table above is missing, it stops before downloading anything and prints what to fix.
2. **Fetches ngp's sources** ([fetch-angular.sh](../toolchain/fetch-angular.sh)). It does a sparse fetch of `packages/compiler-cli/preprocessor` plus the Cargo files at the pinned commit, about 1,500 files instead of the whole Angular repo.
3. **Installs Rust** ([setup-rust.sh](../toolchain/setup-rust.sh)). It installs rustup with the pinned Rust version and the `wasm32` target, and builds `wasm-bindgen-cli` from source. This step is most of the first build's time.
4. **Compiles the TypeScript backend** ([build-backend.sh](../toolchain/build-backend.sh)), with `tsc` against the `@angular/*` packages `pnpm install` just installed. They come from the same commit, which is why every Angular version in this repo is pinned exactly.
5. **Builds the analyzer engines** ([build-engines.sh](../toolchain/build-engines.sh)) with Cargo: the native N-API addon, which the plugin uses by default, and the wasm build, the fallback for platforms without a native build.

The result:

```text
toolchain/out/preprocessor/        ngp's TypeScript backend (api.js is what the plugin imports)
toolchain/out/engines/native/      ng_analyze.node
toolchain/out/engines/wasm/        ng_analyze.js and ng_analyze_bg.wasm
```

## Check it works

```bash
pnpm test
```

This builds the plugin and compiles every playground module through ngp. It also scaffolds both [create-ngp](../packages/create-ngp) templates into a temporary folder, installs them from npm with the plugin packed from the repo, and builds and tests them, so it needs the network. With `vp` on your `PATH`, it does the same again after `vp migrate`. Then:

```bash
pnpm dev
```

This starts Vite on the playground at http://localhost:5173. For a production build, run `pnpm playground:build`.

## Rebuilding

| You changed | Run |
|---|---|
| The plugin's source | nothing: `pnpm dev` and `pnpm test` rebuild it |
| `toolchain/versions.env`, to move to a newer Angular commit | update every `@angular/*` pin to the matching `ANGULAR_NPM_VERSION`, then `pnpm install` and `pnpm toolchain` |
| Only one engine | `bash toolchain/build-engines.sh native` (or `wasm`) |

To start over, delete `toolchain/.cache` and `toolchain/out`.

## The build inside the package

This is about the plugin. The repo's second package, `@push-based/create-ngp` in `packages/create-ngp`, is plain JavaScript with no build and no ngp: what's in the folder is what ships, minus the tests and `scripts/`.

A release carries ngp in `packages/vite-plugin-ngp/ngp`: the backend, the wasm engine, and native engines in `engines/native/<platform>-<arch>/` for `darwin-arm64`, `darwin-x64`, `linux-x64` and `linux-arm64`. The [Publish workflow](../.github/workflows/publish.yml) builds each native engine on its own runner and assembles them with [toolchain/bundle.mjs](../toolchain/bundle.mjs). The Linux ones are built on Ubuntu 22.04 and link against its glibc 2.35, so they don't load on older distros or on musl.

To try the bundled layout locally, with only this machine's engine:

```bash
node toolchain/bundle.mjs --host-only
```

The plugin then loads it when neither `toolchain` nor `NGP_TOOLCHAIN` is set. Delete `packages/vite-plugin-ngp/ngp` to go back. The package's `prepack` refuses to pack a bundle that's missing any platform, so this can't end up in a release.

## When it fails

- **"Can't build ngp yet"** comes from the prerequisite check, and each line names its fix.
- **`linker 'cc' not found`** or a missing `stdlib.h`: the C compiler isn't installed or set up. On macOS, rerun `xcode-select --install`.
- **The fetch fails**: the build needs network access to github.com, static.rust-lang.org and crates.io.
- **`vite-plugin-ngp: ... not found`** or **`no ngp build found`** when you start Vite: the plugin can't find `toolchain/out`. Run `pnpm toolchain`, or set `NGP_TOOLCHAIN` to an ngp build somewhere else.
- **`no native ngp engine for <platform>`**: the build has no native engine for this machine, as on Alpine. Set `engine: 'wasm'`, or run `pnpm toolchain` on this machine and point `toolchain` at the result.
- **TypeScript errors in `build-backend.sh`**: an `@angular/*` package doesn't match `ANGULAR_NPM_VERSION`. Run `pnpm install`, and check that no pin drifted.

[CI](../.github/workflows/ci.yml) runs this whole page on a clean Ubuntu machine for every push, so if it passes there and fails for you, the difference is your machine.
