import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: { port: 5173, open: '/flappy/' },
  build: { outDir: 'dist' }
});
