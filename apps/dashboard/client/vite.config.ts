import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../public/app',
    emptyOutDir: true,
  },
  server: {
    port: 3100,
    proxy: {
      '/api': {
        target: 'https://api.askalf.org',
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
