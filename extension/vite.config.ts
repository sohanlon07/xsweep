import { defineConfig } from 'vite';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: { conditions: ['browser'] },
  plugins: [
    svelte({ preprocess: vitePreprocess() }),
    {
      name: 'standalone-content-script',
      generateBundle(_options, bundle) {
        const content = Object.values(bundle).find(output => output.type === 'chunk' && output.isEntry && output.name === 'content');
        if (content?.type === 'chunk' && (content.imports.length || content.dynamicImports.length)) {
          this.error('MV3 content.js must be a standalone classic script with no module imports.');
        }
      }
    }
  ],
  build: { outDir: 'dist', emptyOutDir: true, rollupOptions: { input: { dashboard: resolve(__dirname, 'dashboard.html'), background: resolve(__dirname, 'src/background.ts'), content: resolve(__dirname, 'src/content/x.ts'), archive: resolve(__dirname, 'src/archive/worker.ts'), headerBridge: resolve(__dirname, 'src/page/x-header-bridge.ts') }, output: { entryFileNames: (chunk) => chunk.name === 'background' ? 'background.js' : chunk.name === 'content' ? 'content.js' : chunk.name === 'archive' ? 'archive-worker.js' : chunk.name === 'headerBridge' ? 'x-header-bridge.js' : 'assets/[name]-[hash].js' } } }
});
