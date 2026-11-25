## 0.4.1 (2026-11-25)

### 🚀 Features

- **create-ngp:** scaffold an angular app on the plugin with npm create @push-based/ngp ([#43](https://github.com/push-based/vite-plugin-ngp/pull/43), [#14](https://github.com/push-based/vite-plugin-ngp/issues/14), [#18](https://github.com/push-based/vite-plugin-ngp/issues/18))
- **vite-plugin-ngp:** add test.jitCompat so TestBed overrides keep NgModule scopes ([#51](https://github.com/push-based/vite-plugin-ngp/pull/51))
- **vite-plugin-ngp:** add test.extendedDiagnostics to report extended checks as warnings ([#52](https://github.com/push-based/vite-plugin-ngp/pull/52))
- **vite-plugin-ngp:** add test.runtimeScopes to drop scope errors TestBed resolves ([#53](https://github.com/push-based/vite-plugin-ngp/pull/53))
- **vite-plugin-ngp:** keep @defer dependencies static under test.jitCompat ([#54](https://github.com/push-based/vite-plugin-ngp/pull/54))

### 🩹 Fixes

- **vite-plugin-ngp:** place external template diagnostics in the template ([#48](https://github.com/push-based/vite-plugin-ngp/pull/48))
- **vite-plugin-ngp:** report template errors under pnpm 11 and vite+ instead of crashing ([#44](https://github.com/push-based/vite-plugin-ngp/pull/44), [#15](https://github.com/push-based/vite-plugin-ngp/issues/15), [#16](https://github.com/push-based/vite-plugin-ngp/issues/16))
- **vite-plugin-ngp:** link angular libraries in server environments the plugin doesn't own ([#47](https://github.com/push-based/vite-plugin-ngp/pull/47), [#46](https://github.com/push-based/vite-plugin-ngp/issues/46))
- **vite-plugin-ngp:** key the output cache on the preprocessor's code ([#49](https://github.com/push-based/vite-plugin-ngp/pull/49))

### ❤️ Thank You

- Christopher Holder @ChristopherPHolder
- ChristopherPHolder
- GreedyAI

## 0.4.0 (2026-11-18)

### 📦 Build

- ⚠️  **vite-plugin-ngp:** move Angular to 22.3.0-rc.0 ([#45](https://github.com/push-based/vite-plugin-ngp/pull/45))

### ⚠️  Breaking Changes

- **vite-plugin-ngp:** move Angular to 22.3.0-rc.0  ([#45](https://github.com/push-based/vite-plugin-ngp/pull/45))

### ❤️ Thank You

- Christopher Holder @ChristopherPHolder

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