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
        dino: resolve(__dirname, root, 'games/3-dino.html'),
        flappy: resolve(__dirname, root, 'games/4-flappy.html'),
        game1: resolve(__dirname, root, 'games/1-gesture-lock.html'),
        game2: resolve(__dirname, root, 'games/2-pantomime.html'),
        games: resolve(__dirname, root, 'games.html'),
        manual: resolve(__dirname, root, 'games/manual.html'),
      },
    },
  },
});
