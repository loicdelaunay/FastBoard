/**
 * Construit un exécutable Windows autonome (`release/FastBoard.exe`) : Node + serveur + interface dans un seul fichier.
 *
 *   npm run build:exe            → build de l'interface, bundle du serveur, injection dans une copie de node.exe
 *   npm run build:exe -- --skip-front   (réutilise dist/ déjà construit)
 *
 * Principe : esbuild regroupe le serveur TypeScript en un fichier JS ; le « Single Executable Application » de Node y
 * ajoute l'interface (dist/), le guide de l'API et les fichiers de Swagger UI comme ressources embarquées ; postject
 * injecte le tout dans une copie de node.exe. Aucune installation de Node n'est nécessaire pour l'utiliser.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { inject } from 'postject';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.join(root, 'release');
const workDir = path.join(releaseDir, 'build');
const exeName = process.platform === 'win32' ? 'FastBoard.exe' : 'FastBoard';
const exePath = path.join(releaseDir, exeName);
const skipFront = process.argv.includes('--skip-front');
const require = createRequire(import.meta.url);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' && command === 'npm', ...options });
  if (result.status !== 0) {
    throw new Error(`« ${command} ${args.join(' ')} » a échoué (code ${result.status}).`);
  }
}

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

console.log('1/5  Interface (vite build)…');
if (!skipFront) {
  run('npm', ['run', 'build']);
}
if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
  throw new Error("dist/index.html est introuvable : lancez « npm run build » d'abord.");
}

console.log('2/5  Serveur (esbuild)…');
fs.rmSync(workDir, { recursive: true, force: true });
fs.mkdirSync(workDir, { recursive: true });
const bundle = path.join(workDir, 'fastboard.cjs');
await build({
  entryPoints: [path.join(root, 'server', 'index.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  // `ws` essaie ces accélérateurs natifs facultatifs dans un try/catch.
  external: ['bufferutil', 'utf-8-validate'],
  logLevel: 'warning',
  // `import.meta` n'existe pas en CommonJS ; le code ne le lit que hors exécutable.
  define: { 'import.meta.url': 'undefined', 'import.meta.dirname': 'undefined' },
  legalComments: 'none',
});

console.log('3/5  Ressources embarquées…');
const assets = {};
for (const file of listFiles(path.join(root, 'dist'))) {
  assets[`dist/${path.relative(path.join(root, 'dist'), file).split(path.sep).join('/')}`] = file;
}
const swaggerDir = path.dirname(require.resolve('swagger-ui-dist/package.json'));
for (const name of ['swagger-ui.css', 'swagger-ui-bundle.js']) {
  assets[`swagger/${name}`] = path.join(swaggerDir, name);
}
assets['docs/API.md'] = path.join(root, 'docs', 'API.md');
const blobPath = path.join(workDir, 'sea-prep.blob');
const seaConfig = path.join(workDir, 'sea-config.json');
fs.writeFileSync(seaConfig, JSON.stringify({ main: bundle, output: blobPath, disableExperimentalSEAWarning: true, useCodeCache: false, assets }, null, 2));
console.log(`     ${Object.keys(assets).length} fichiers`);

console.log('4/5  Blob SEA…');
run(process.execPath, ['--experimental-sea-config', seaConfig]);

console.log(`5/5  Injection dans ${exeName}…`);
fs.mkdirSync(releaseDir, { recursive: true });
fs.rmSync(exePath, { force: true });
fs.copyFileSync(process.execPath, exePath);
await inject(exePath, 'NODE_SEA_BLOB', fs.readFileSync(blobPath), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ...(process.platform === 'darwin' ? { machoSegmentName: 'NODE_SEA' } : {}),
});

fs.rmSync(workDir, { recursive: true, force: true });
const megabytes = (fs.statSync(exePath).size / (1024 * 1024)).toFixed(1);
console.log(`\nExécutable prêt : ${path.relative(root, exePath)} (${megabytes} Mo, Node ${process.version})`);
