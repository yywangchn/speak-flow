/// <reference types="vitest" />
import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../../node_modules/.vite/libs/chat/data-access',
  plugins: [angular(), nxViteTsPaths()],
  test: {
    name: 'chat-data-access',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.ts'],
    setupFiles: ['src/test-setup.ts'],
    reporters: ['default'],
  },
}));
