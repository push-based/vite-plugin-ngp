import {resolve} from 'node:path';
import {defineConfig} from 'vitest/config';
import {ngp} from '@push-based/vite-plugin-ngp';

export default defineConfig({
  plugins: [ngp({toolchain: process.env.NGP_TOOLCHAIN ?? resolve(import.meta.dirname, '../toolchain/out')})],
  test: {
    environment: 'node',
    setupFiles: ['src/test-setup.ts'],
  },
});
