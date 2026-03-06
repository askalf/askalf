/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_SELFHOSTED': JSON.stringify(process.env['SELFHOSTED'] || 'false'),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/stores/**'],
      reporter: ['text', 'html'],
    },
  },
  build: {
    outDir: '../public/app',
    emptyOutDir: true,
  },
  server: {
    port: 3100,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
