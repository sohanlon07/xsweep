import { defineConfig } from 'vite';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: { conditions: ['browser'] },
  plugins: [svelte({ preprocess: vitePreprocess() })],
  build: { outDir: 'dist', emptyOutDir: true, rollupOptions: { input: { dashboard: resolve(__dirname, 'dashboard.html'), background: resolve(__dirname, 'src/background.ts'), content: resolve(__dirname, 'src/content/x.ts'), archive: resolve(__dirname, 'src/archive/worker.ts') }, output: { entryFileNames: (chunk) => chunk.name === 'background' ? 'background.js' : chunk.name === 'content' ? 'content.js' : chunk.name === 'archive' ? 'archive-worker.js' : 'assets/[name]-[hash].js' } } }
});
