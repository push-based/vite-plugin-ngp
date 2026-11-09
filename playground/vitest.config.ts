import {resolve} from 'node:path';
import {playwright} from '@vitest/browser-playwright';
import {defineConfig} from 'vitest/config';
import {ngp} from '@push-based/vite-plugin-ngp';

// The same specs, three ways: in Node on the server platform's DOM (the default), on jsdom, and in
// a real Chromium through Vitest's browser mode.
export default defineConfig({
  plugins: [ngp({toolchain: process.env.NGP_TOOLCHAIN ?? resolve(import.meta.dirname, '../toolchain/out')})],
  test: {
    projects: [
      {extends: true, test: {name: 'server', environment: 'node', setupFiles: ['src/testing/server.ts']}},
      {extends: true, test: {name: 'jsdom', environment: 'jsdom', setupFiles: ['src/testing/jsdom.ts']}},
      {
        extends: true,
        test: {
          name: 'browser',
          setupFiles: ['src/testing/browser.ts'],
          browser: {enabled: true, headless: true, provider: playwright(), instances: [{browser: 'chromium'}]},
        },
      },
    ],
  },
});
