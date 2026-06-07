import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' makes built asset paths relative so Electron can load index.html
// via file:// in the packaged app.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
