import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { globSync } from 'node:fs';

const root = 'src';
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
  // GitHub Pages serves this repo from a sub-path (davidzoufaly.github.io/arcade-arena/).
  // The CI build sets GITHUB_PAGES=1; locally base stays '/'. Vite prepends base to
  // built asset URLs and exposes it as import.meta.env.BASE_URL (used in vision paths).
  base: process.env.GITHUB_PAGES ? '/arcade-arena/' : '/',
  // @mediapipe/tasks-vision loads only via a dynamic import() in shared/vision.js
  // (keeps the heavy AI bundle lazy). Vite's dep optimizer scans the initial module
  // graph at startup and never sees it, so the first time a game starts the camera
  // Vite discovers it cold, re-optimizes, bumps the browser hash and reloads —
  // aborting the in-flight import ("Failed to fetch dynamically imported module").
  // Pre-bundling it at startup keeps the dynamic import on a stable hash.
  optimizeDeps: { include: ['@mediapipe/tasks-vision'] },
  server: { port: 5173, open: '/index.html' },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: { input },
  },
});
