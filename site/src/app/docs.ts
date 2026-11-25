export interface DocHeading {
  id: string;
  text: string;
  depth: number;
}

/** A page from content/, as the markdown plugin in scripts/markdown.ts compiles it. */
export interface Doc {
  title: string;
  description: string;
  html: string;
  headings: DocHeading[];
  /** The date of the last commit that changed the page, as YYYY-MM-DD; '' if unknown. */
  updated: string;
}

/**
 * Sidebar sections, in order. Guide: setup and the core model. Features: one page per capability
 * (styles, type-checking, Vitest, i18n, ...). Project: status, performance, changelog.
 */
export const SECTIONS = ['Guide', 'Features', 'Project'] as const;

export interface DocEntry {
  path: string;
  label: string;
  section: (typeof SECTIONS)[number];
  load: () => Promise<Doc>;
}

/**
 * Every docs page, in sidebar order within its section. Routes, the sidebar and the prerender list
 * come from here: adding a page is a content/<path>.md file plus one entry below.
 */
export const DOCS: DocEntry[] = [
  {path: 'getting-started', label: 'Getting started', section: 'Guide', load: () => import('../../content/getting-started.md').then((m) => m.default)},
  {path: 'vite-plus', label: 'Using Vite+', section: 'Guide', load: () => import('../../content/vite-plus.md').then((m) => m.default)},
  {path: 'how-it-works', label: 'How it works', section: 'Guide', load: () => import('../../content/how-it-works.md').then((m) => m.default)},
  {path: 'comparison', label: 'Compared with alternatives', section: 'Guide', load: () => import('../../content/comparison.md').then((m) => m.default)},
  {path: 'configuration', label: 'Configuration', section: 'Guide', load: () => import('../../content/configuration.md').then((m) => m.default)},
  {path: 'migrating-from-ng-build', label: 'Migrating from ng build', section: 'Guide', load: () => import('../../content/migrating-from-ng-build.md').then((m) => m.default)},
  {path: 'nx', label: 'Migrating inside Nx', section: 'Guide', load: () => import('../../content/nx.md').then((m) => m.default)},
  {path: 'server-rendering', label: 'Server rendering', section: 'Guide', load: () => import('../../content/server-rendering.md').then((m) => m.default)},
  {path: 'testing', label: 'Testing with Vitest', section: 'Features', load: () => import('../../content/testing.md').then((m) => m.default)},
  {path: 'type-checking', label: 'Type-checking', section: 'Features', load: () => import('../../content/type-checking.md').then((m) => m.default)},
  {path: 'styles', label: 'Component styles', section: 'Features', load: () => import('../../content/styles.md').then((m) => m.default)},
  {path: 'i18n', label: 'Internationalization', section: 'Features', load: () => import('../../content/i18n.md').then((m) => m.default)},
  {path: 'status', label: 'Status and limits', section: 'Project', load: () => import('../../content/status.md').then((m) => m.default)},
  {path: 'compatibility', label: 'Compatibility', section: 'Project', load: () => import('../../content/compatibility.md').then((m) => m.default)},
  {path: 'performance', label: 'Performance', section: 'Project', load: () => import('../../content/performance.md').then((m) => m.default)},
  {path: 'benchmarks', label: 'Benchmarks: real apps', section: 'Project', load: () => import('../../content/benchmarks.md').then((m) => m.default)},
  {path: 'changelog', label: 'Changelog', section: 'Project', load: () => import('../../content/changelog.md').then((m) => m.default)},
];

