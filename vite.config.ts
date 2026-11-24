import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

/**
 * Service worker de l'application installée (PWA), écrit à la construction : `src/pwa/sw.template.js` avec la version
 * et la coquille à garder pour s'ouvrir sans réseau (la page, le script d'entrée et ce qu'il importe d'office, leurs
 * styles, les icônes). Les autres morceaux de l'interface sont gardés quand ils servent.
 */
const serviceWorker: Plugin = {
  name: 'fastboard-service-worker',
  apply: 'build',
  generateBundle(_options, bundle) {
    const shell = new Set(['/', '/favicon.svg', '/theme-boot.js', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png']);
    const visit = (fileName: string): void => {
      const chunk = bundle[fileName];
      if (!chunk || chunk.type !== 'chunk' || shell.has(`/${fileName}`)) return;
      shell.add(`/${fileName}`);
      for (const css of chunk.viteMetadata?.importedCss ?? []) shell.add(`/${css}`);
      chunk.imports.forEach(visit);
    };
    for (const [fileName, chunk] of Object.entries(bundle)) if (chunk.type === 'chunk' && chunk.isEntry) visit(fileName);
    const files = [...shell].sort();
    const version = `${APP_VERSION}-${createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 10)}`;
    const template = readFileSync(fileURLToPath(new URL('./src/pwa/sw.template.js', import.meta.url)), 'utf8');
    this.emitFile({ type: 'asset', fileName: 'sw.js', source: template.replace('__VERSION__', version).replace('__SHELL__', JSON.stringify(files)) });
  },
};

const apiTarget = process.env.FASTBOARD_API ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [vue(), versionMeta, serviceWorker],
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
