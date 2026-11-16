# Releasing

This page is for whoever publishes vite-plugin-ngp to npm, as `@push-based/vite-plugin-ngp`. It follows PushBased's publishing setup, the same one push-based/zod2nx-schema uses: Nx release picks the version from conventional commits, one GitHub workflow tags and creates the release, and a second publishes to npm without an npm token.

Two packages are published, under the push-based npm org's scope like the org's other packages: `packages/vite-plugin-ngp` as `@push-based/vite-plugin-ngp`, and `packages/create-ngp` as `@push-based/create-ngp`, the scaffolder behind `npm create @push-based/ngp`. Their Nx project names stay `vite-plugin-ngp` and `create-ngp` (the `nx` field in each `package.json`), so those are the commit scopes and the names in `nx.json`. Nx releases them as one fixed group: both always have the same version, which is how a scaffolder at `x.y.z` knows to pin the plugin at `x.y.z`. The playground, the site and the bench are private. The package carries its own ngp build, so users don't run `pnpm toolchain`: ngp's TypeScript backend, the wasm engine, and a native engine for macOS arm64 and x64 and Linux x64 and arm64 (glibc). A package with one native engine packed to 3.4 MB; with all four it should be about 10 MB, if the other three compress like the macOS arm64 one (2.1 MB).

## Commit messages

Releases are computed from commit messages, so every commit on `main` is a [conventional commit](https://www.conventionalcommits.org/):

```text
feat(vite-plugin-ngp): reload the page when angular.json changes
```

- **Types** are commitlint's conventional set (`feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `style`, `revert`), plus `release` for the commit Nx release makes.
- **Scopes** are optional. When you give one, it's a workspace project (`vite-plugin-ngp`, `create-ngp`, `playground`, `site`) or `bench`, `toolchain` or `workflows`.
- **The subject** is in the imperative present tense: "add", not "added" or "adds".

`feat` bumps the minor version and `fix` or `perf` bumps the patch. A `!` after the type, or a `BREAKING CHANGE:` footer, bumps the major version. Other types don't bump the version. While the version is 0.x, Nx shifts each bump down a level: a breaking change bumps the minor and a `feat` bumps the patch.

The commit-msg hook in `.husky` checks each commit locally. `pnpm install` installs it. On a pull request, the PR Commitlint workflow checks the title, because a squash merge turns the title into the commit on `main`. Commits made before 20 October 2026 aren't conventional, and Nx release skips them.

## Cutting a release

1. In the Actions tab, run **Release** on `main`. It computes the version from the commits since the last `v*` tag, updates `packages/vite-plugin-ngp/package.json` and `CHANGELOG.md`, commits `release: <version>`, tags `v<version>`, pushes both, and creates the GitHub release. If no commit since the last tag bumps the version, it does nothing.
2. The tag starts **Publish**. It builds ngp's native engine on four runners, one per platform, loads each on the system it was built for, and bundles them with the backend and the wasm engine into `packages/vite-plugin-ngp/ngp` ([toolchain/bundle.mjs](../toolchain/bundle.mjs)). Then it packs both packages, uploads the tarballs as the `vite-plugin-ngp-package` and `create-ngp-package` artifacts, and publishes them to npm with provenance. If the run fails, start Publish again by hand on the tag; a version already on npm is skipped.
3. When both are on npm, Publish calls **create-ngp e2e** ([create-ngp-e2e.yml](../.github/workflows/create-ngp-e2e.yml)) with the new version. On a fresh runner with the latest Vite+, it runs `vp create @push-based/ngp@<version>` for each template, then `vp check`, `vp build` and `vp test run`, and for `app-ssr` renders a page from `server.mjs`. A template that pins a plugin version npm doesn't have, or a Vite+ rewrite the plugin can't load under, fails here. The same workflow runs every Monday against `latest`, because a Vite+ release can change that rewrite with no release of ours, and by hand from the Actions tab with any version. A failure there doesn't unpublish anything: fix it and release again.

`create-ngp`'s `prepack` refuses to pack when a template pins another Angular, Vite, Vitest, TypeScript, rxjs or tslib than the repo uses ([check-pins.mjs](../packages/create-ngp/scripts/check-pins.mjs)). The plugin's `prepack` script refuses to pack unless all four native engines are there and each is the binary its folder names, so a laptop can't publish a package with only its own engine. To try the bundled build locally, `node toolchain/bundle.mjs --host-only` bundles this machine's engine from `toolchain/out`. The plugin uses it when neither `toolchain` nor `NGP_TOOLCHAIN` is set.

To check the whole build without publishing, run **Publish** by hand with **Dry run** ticked. It does everything above except the upload to npm, and the tarball artifact is what a release would publish. A first run takes about as long as CI's cold build on each runner, around 8 minutes. After that the Rust caches make it faster.

To preview a release on CI, run **Release** with **Dry run** ticked. It prints the version and changelog it would make and pushes nothing. It also checks that the bot's token can push to the repo, so it's the way to test `GH_APP_ID` and `GH_APP_PRIVATE_KEY` after setting them up. It doesn't test the bypass of `main`'s branch protection, because GitHub only checks that on a real push.

To preview a release locally without changing anything:

```bash
pnpm nx release --dry-run --skip-publish
```

`CHANGELOG.md` lists commits for each version. The site's [changelog](../site/content/changelog.md) stays the place that explains what changed for users, and still gets its line in the same commit as the change.

## One-time setup

| Step | Where | Who |
|---|---|---|
| Install the [PushBased Bot](https://github.com/apps/pushbased-bot) GitHub App (`pushbased-bot`) on the repo | Org settings → GitHub Apps → PushBased Bot → Configure → Repository access | Org owner |
| Create the `release` environment with variable `GH_APP_ID` = `2781189` and secret `GH_APP_PRIVATE_KEY` | Repo settings → Environments | Repo admin; the key comes from an EM |
| Protect `main`: require a pull request, and let `pushbased-bot` bypass it so Release can push | Repo settings → Branches | Repo admin |
| Publish the first version by hand (below) | A maintainer's machine | Someone in the push-based npm org |
| Add the trusted publisher: GitHub Actions, `push-based` / `vite-plugin-ngp`, workflow `publish.yml`, environment `release` | npmjs.com → `@push-based/vite-plugin-ngp` → Settings | Same person |
| Publish `@push-based/create-ngp`'s first version by hand, and add the same trusted publisher to it | A maintainer's machine, then npmjs.com → `@push-based/create-ngp` → Settings | Same person |

The first version has to be published by hand, because npm only lets you add a trusted publisher to a package that already exists. Publish it from the tarball CI builds, not from your machine, which only has its own platform's engine. Tag the release first. With no `v*` tag in the repo yet, that's `pnpm nx release 0.1.0 --first-release --skip-publish`. Once one exists, it's:

```bash
pnpm nx release --skip-publish
```

That needs `GH_TOKEN` set, or `gh` logged in, to create the GitHub release. The tag starts Publish, which fails at its last step because npm doesn't know the package yet. Its tarball is complete. Download it, log in, and publish it:

```bash
gh run download --name vite-plugin-ngp-package --dir first-release
```

```bash
npm login
```

```bash
npm publish ./first-release/push-based-vite-plugin-ngp-0.2.0.tgz
```

`gh run download` without a run id asks which run to take: pick the Publish run for the tag you just pushed. Write the path with `./`, or npm reads `first-release/...` as a GitHub repo. The package's `publishConfig` makes it public; without it npm would publish a scoped package as private. This first version has no provenance; every version the workflow publishes does. After the trusted publisher is saved, set the package's publishing access on npmjs.com to require two-factor authentication and disallow tokens, so only the workflow can publish.

### The first version of create-ngp

`@push-based/create-ngp` needs the same by-hand first version, for the same reason, but it's simpler: it has no native engines, so a tarball packed on any machine is the real thing. Publish it at the version of the plugin's latest release, since the version it carries is the plugin version its templates pin. From `main`, with that version in `packages/create-ngp/package.json`:

```bash
cd packages/create-ngp
```

```bash
npm login
```

```bash
npm publish
```

`prepack` checks the template pins first. Then add the trusted publisher on npmjs.com exactly as for the plugin, and require two-factor authentication with tokens disallowed. Until the trusted publisher is saved, Publish fails on `create-ngp`. Start it again on the tag once it's saved; a version already on npm is skipped.

Renaming `publish.yml` or the `release` environment breaks publishing until the npm settings are changed to match.

`v0.1.0` is a tag with no GitHub release and nothing on npm: the package was renamed to its scoped name before anyone published it, and the release was deleted. The tag stays because Nx reads the current version from it. The first version on npm is `0.2.0`.
