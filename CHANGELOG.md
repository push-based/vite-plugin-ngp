## 0.3.0 (2026-11-10)

### 🚀 Features

- **vite-plugin-ngp:** keep ngp, linker and optimizer output between builds and test runs ([#24](https://github.com/push-based/vite-plugin-ngp/pull/24), [#21](https://github.com/push-based/vite-plugin-ngp/issues/21))

### 🩹 Fixes

- **vite-plugin-ngp:** fail on a mistyped extendedDiagnostics option instead of dropping the checks ([b221bb4](https://github.com/push-based/vite-plugin-ngp/commit/b221bb4))
- **vite-plugin-ngp:** reject an engine that is neither native nor wasm ([#7](https://github.com/push-based/vite-plugin-ngp/pull/7))
- **vite-plugin-ngp:** print usage instead of a stack trace for a bad ngp-extract-i18n flag ([#10](https://github.com/push-based/vite-plugin-ngp/pull/10))
- **vite-plugin-ngp:** close the compilers when a middleware-mode dev server closes ([#12](https://github.com/push-based/vite-plugin-ngp/pull/12))
- **vite-plugin-ngp:** include a custom ssr entry in the default entries ([#8](https://github.com/push-based/vite-plugin-ngp/pull/8))
- **vite-plugin-ngp:** put ssr output under build.outDir instead of a fixed dist ([#11](https://github.com/push-based/vite-plugin-ngp/pull/11))
- **vite-plugin-ngp:** send template updates for components outside the app root ([#25](https://github.com/push-based/vite-plugin-ngp/pull/25), [#20](https://github.com/push-based/vite-plugin-ngp/issues/20))

### 🔥 Performance

- **vite-plugin-ngp:** link libraries with angular's linker over vite's oxc parser, not babel ([41dc6a4](https://github.com/push-based/vite-plugin-ngp/commit/41dc6a4))

### 📦 Build

- list build commits in changelogs and turn off nx analytics ([19b941a](https://github.com/push-based/vite-plugin-ngp/commit/19b941a))
- **bench:** regenerate the lockfile for angular 22.3.0-next.4 ([da3e423](https://github.com/push-based/vite-plugin-ngp/commit/da3e423))
- ⚠️  **vite-plugin-ngp:** move Angular to 22.3.0-next.4 ([4aa5dc6](https://github.com/push-based/vite-plugin-ngp/commit/4aa5dc6))
- **vite-plugin-ngp:** align @babel/core with compiler-cli ([d5c1143](https://github.com/push-based/vite-plugin-ngp/commit/d5c1143))

### ⚠️  Breaking Changes

- **vite-plugin-ngp:** move Angular to 22.3.0-next.4  ([4aa5dc6](https://github.com/push-based/vite-plugin-ngp/commit/4aa5dc6))

### ❤️ Thank You

- Christopher Holder @ChristopherPHolder
- ChristopherPHolder

## 0.2.0 (2026-10-21)

The first version on npm, as `@push-based/vite-plugin-ngp`. 0.1.0 was tagged under the unscoped name `vite-plugin-ngp` and never published.

### 🚀 Features

- **vite-plugin-ngp:** ship ngp inside the package, native for four platforms ([2fb7d13](https://github.com/push-based/vite-plugin-ngp/commit/2fb7d13))

### 📦 Build

- ⚠️  **vite-plugin-ngp:** publish as @push-based/vite-plugin-ngp ([e8aadb9](https://github.com/push-based/vite-plugin-ngp/commit/e8aadb9))

### ⚠️  Breaking Changes

- **vite-plugin-ngp:** publish as @push-based/vite-plugin-ngp ([e8aadb9](https://github.com/push-based/vite-plugin-ngp/commit/e8aadb9))
  Import the plugin from `'@push-based/vite-plugin-ngp'`. If you installed it from a clone, run `pnpm install` again and change that one import.

### ❤️ Thank You

- Christopher Holder

## 0.1.0 (2026-10-21)

Tagged but never published to npm.

### 🚀 Features

- **vite-plugin-ngp:** ship ngp inside the package, native for four platforms ([2fb7d13](https://github.com/push-based/vite-plugin-ngp/commit/2fb7d13))

### ❤️ Thank You

- Christopher Holder