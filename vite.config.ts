import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const packageInfo = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const git = (args: string[], fallback: string) => {
  try { return execFileSync('git', args, { cwd: new URL('.', import.meta.url), encoding: 'utf8', windowsHide: true }).trim(); }
  catch { return fallback; }
};
const buildInfo = { version: packageInfo.version, builtAt: process.env.READER_BUILD_TIME || new Date().toISOString(),
  revision: git(['rev-parse', '--short=12', 'HEAD'], 'unknown'), dirty: !!git(['status', '--porcelain'], 'unknown') };

export default defineConfig({
  plugins: [sveltekit()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,   // 端口被占用时直接报错，不自动跳转
    host: '127.0.0.1',  // 强制 IPv4
  },
  envPrefix: ['VITE_', 'TAURI_'],
  define: {
    __READER_BUILD_INFO__: JSON.stringify(buildInfo),
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
  },
  optimizeDeps: {
    include: ['markdown-it', 'katex', 'mermaid', 'yaml'],
  },
  build: {
    target: ['es2021', 'chrome100', 'safari13'],
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    // Mermaid and KaTeX are intentionally lazy feature chunks in the desktop app.
    // Keep the warning threshold above those chunks so new warnings point at regressions.
    chunkSizeWarningLimit: 3200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;

          if (id.includes('/@codemirror/') || id.includes('/codemirror/')) {
            return 'vendor-codemirror';
          }

          if (id.includes('/@lezer/')) {
            return 'vendor-lezer';
          }

          if (id.includes('/katex/')) {
            return 'vendor-katex';
          }

          if (id.includes('/mermaid/')) {
            return 'vendor-mermaid';
          }

          if (id.includes('/shiki/') || id.includes('/@shikijs/')) {
            return 'vendor-shiki';
          }

          if (id.includes('/markdown-it/') || id.includes('/linkify-it/') || id.includes('/mdurl/')) {
            return 'vendor-markdown';
          }

          return;
        },
      },
    },
  },
});
