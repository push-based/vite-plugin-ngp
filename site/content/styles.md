---
title: Component styles
description: How styleUrl files go through Vite's CSS pipeline, so SCSS works, styles stay encapsulated, and a style edit updates the page in place.
---

# Component styles

A component's `styleUrl` and `styleUrls` files go through Vite like any imported stylesheet. Vite compiles them, Sass or Less included, runs your PostCSS config and rewrites `url()`s. Then the plugin applies Angular's view encapsulation, so the selectors only match inside the component, as under `ng build`. In the dev server, editing a stylesheet updates the page without a reload, and the component keeps its state.

This page is for you if your components use stylesheet files, and especially if they're SCSS.

## What you need to do

Install the preprocessor, as for any Vite app:

```bash
pnpm add -D sass
```

That's all. Vite's `css` options apply to component stylesheets too, so a Sass load path goes in `css.preprocessorOptions.scss`, where angular.json had `stylePreprocessorOptions`. Global stylesheets work the Vite way: import them from `main.ts` or link them from `index.html`.

## Inline styles stay plain CSS

The `styles` field and `<style>` elements in templates are compiled by ngp, not Vite, and ngp has no hook to run a preprocessor on them. They're shipped as plain CSS: Sass variables, mixins and `@use` don't work there. The Angular CLI's `inlineStyleLanguage` option has no equivalent. Move anything that needs Sass into a file.

Inline styles still update in place when you edit them, as [How it works](how-it-works#component-hmr) describes.

## In the dev server

Angular's runtime adds a `<link>` for each of a component's stylesheets, with the component's encapsulation id in the query: `card.ngp-de07cd19.css?ngcomp=ng-c1189429506&e=0`. Vite compiles the file, and the plugin scopes the result to that id with Angular's own encapsulation code. Components with `ViewEncapsulation.None` or `ShadowDom` get the CSS unscoped. The name is the file's name plus a hash of its path, with no directory, because Angular only reuses server-rendered `<link>`s whose URL has no directory in it.

When you save a stylesheet, or a Sass partial it uses, the plugin reloads that stylesheet's `<link>`s in place and nothing else. Component state survives. On the playground's Styles page, a meter set to level 3 stays at level 3 while its colors change. `ShadowDom` components update in place too, where `ng serve` reloads the page for them.

Without server rendering, a `<link>` added by script doesn't block rendering, so a component can appear unstyled for a moment the first time it renders. With [`ssr`](server-rendering) on, the server-rendered page already has the `<link>`s, and the browser reuses them.

## In builds

`vite build` puts each stylesheet into the JavaScript, as `ng build` does: no separate CSS files and no extra requests. Vite compiles and minifies it, and the plugin scopes it for the component. Server bundles get the same, so server-rendered pages carry the scoped CSS in `<style>` elements.

Measured on the playground, a chunk with stylesheet files is 3 to 5% smaller than when ngp inlined the files itself, because Vite minifies the CSS. Gzipped, the difference is under 1%.

## Under Vitest

Specs get stylesheets the build way, inlined, because nothing would load a `<link>` in Node or jsdom. Vitest stubs CSS to empty strings by default, so components render unstyled. Set `test.css: true` if a spec checks styles: the scoped SCSS then reaches the page, and `getComputedStyle` sees it. See [Testing with Vitest](testing).

## Differences from the Angular CLI

| | Angular CLI | vite-plugin-ngp |
|---|---|---|
| SCSS, Sass, Less in `styleUrl` files | Yes | Yes, through Vite |
| Preprocessor in inline `styles` | With `inlineStyleLanguage` | No |
| Preprocessor options | `stylePreprocessorOptions` | Vite's `css.preprocessorOptions` |
| Global stylesheets | `styles` in `angular.json` | Imported from `main.ts` or linked from `index.html` |
| Editing a stylesheet of a `ShadowDom` component | Reloads the page | Updates in place |
| Changing which file `styleUrl` points to | Updates in place | Reloads the page |

## Where it's weak

- **Dev and builds take different paths.** The dev server serves `<link>`s and builds inline the CSS, as the CLI does. Tests cover both, but a bug can show in one and not the other, so check a build before you ship.
- **The plugin finds stylesheets in ngp's output by pattern.** It looks for `ɵɵExternalStylesFeature([...])` in the compiled code. If ngp changes how it prints that call, the tests fail, but your build could too, until the plugin catches up.
- **Source maps for scoped stylesheets aren't adjusted.** With `css.devSourcemap` on, a rule maps to the right line, but the attributes scoping adds can shift columns.
- **Style updates use their own event.** Vite's built-in CSS update drops the `ngcomp` query and updates only the first matching `<link>`, so the plugin sends `angular:stylesheet-update` and swaps the links itself, with a few lines of script it imports into components in the dev server.
