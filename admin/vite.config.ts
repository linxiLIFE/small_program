import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { assetCache } from './build/asset-cache';

export default defineConfig({
  plugins: [vue(), assetCache()],
  base: '/store-admin/',
  server: { port: 4173, host: '127.0.0.1' },
  build: { sourcemap: true }
});
