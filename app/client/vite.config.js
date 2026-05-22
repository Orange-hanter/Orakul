import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Shared constants (../shared) живут вне client/, чтобы один файл читался
// и сервером (CJS) и клиентом (Vite). Разрешаем Vite их видеть.
const sharedDir = path.resolve(__dirname, '../shared');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': sharedDir,
    },
  },
  server: {
    port: 5173,
    fs: { allow: [path.resolve(__dirname), sharedDir] },
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
