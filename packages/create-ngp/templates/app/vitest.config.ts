import { defineConfig } from 'vitest/config';
import { ngp } from '@push-based/vite-plugin-ngp';

// Specs run in Node on Domino, the DOM Angular renders with on the server. The Testing page on
// https://push-based.github.io/vite-plugin-ngp/testing/ has the jsdom and browser-mode setups.
export default defineConfig({
  plugins: [ngp()],
  test: {
    environment: 'node',
    setupFiles: ['src/test-setup.ts'],
  },
});
