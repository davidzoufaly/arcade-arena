import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const root = 'ps-offsite-2026';

export default defineConfig({
  root,
  server: { port: 5173, open: '/index.html' },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        index: resolve(__dirname, root, 'index.html'),
        scoreboard: resolve(__dirname, root, 'scoreboard.html'),
        dino: resolve(__dirname, root, 'dino/index.html'),
        flappy: resolve(__dirname, root, 'flappy/index.html'),
        station1: resolve(__dirname, root, 'stations/1-gesture-lock.html'),
        station2: resolve(__dirname, root, 'stations/2-pantomime.html'),
      },
    },
  },
});
