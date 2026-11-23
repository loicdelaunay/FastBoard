import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig, type Plugin } from 'vite';
import { APP_VERSION } from './shared/changelog';

/**
 * Note la version dans la page d'accueil : le serveur sait ainsi quelle interface il sert, et prévient quand elle n'a
 * pas été reconstruite après une mise à jour (voir `server/services/interfaceVersion.ts`).
 */
const versionMeta: Plugin = {
  name: 'fastboard-version',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'fastboard-version', content: APP_VERSION }, injectTo: 'head' }],
};

const apiTarget = process.env.FASTBOARD_API ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [vue(), versionMeta],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: apiTarget },
      '/ws': { target: apiTarget, ws: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 900,
  },
});
