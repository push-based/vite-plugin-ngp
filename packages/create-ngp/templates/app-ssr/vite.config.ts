import { defineConfig } from 'vite';
import { ngp } from '@push-based/vite-plugin-ngp';

export default defineConfig({
  // Renders every page with src/main.server.ts, in the dev server and in `vite build`.
  plugins: [ngp({ ssr: true })],
});
