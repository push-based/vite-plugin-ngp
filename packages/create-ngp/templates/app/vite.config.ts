import { defineConfig } from 'vite';
import { ngp } from '@push-based/vite-plugin-ngp';

export default defineConfig({
  plugins: [ngp()],
});
