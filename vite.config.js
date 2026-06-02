import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { globSync } from 'node:fs';

const root = 'ps-offsite-2026';
const rootDir = resolve(__dirname, root);

// Auto-discover every .html entry under the Vite root so new pages
// (e.g. games/*.html) get built without touching this config.
const input = Object.fromEntries(
  globSync('**/*.html', { cwd: rootDir }).map((file) => [
    file.replace(/\.html$/, '').replace(/[/\\]/g, '-'),
    resolve(rootDir, file),
  ]),
);

export default defineConfig({
  root,
  server: { port: 5173, open: '/index.html' },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: { input },
  },
});
