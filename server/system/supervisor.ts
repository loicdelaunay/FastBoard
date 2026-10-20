import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { runningAsExecutable } from '../runtime.ts';

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const STABLE_AFTER_MS = 60_000;

/** Commande qui relance ce même programme sans `--supervise` (exécutable autonome ou `node server/index.ts`). */
export function childCommand(): { file: string; args: string[] } {
  // Dans l'exécutable autonome, argv[1] répète le chemin de l'exécutable.
  const args = process.argv.slice(runningAsExecutable ? 2 : 1).filter((arg) => arg !== '--supervise');
  return { file: process.execPath, args: runningAsExecutable ? args : [...process.execArgv.filter((arg) => !arg.startsWith('--watch')), ...args] };
}

/**
 * Mode service : lance le serveur dans un processus enfant et le relance s'il s'arrête (attente croissante jusqu'à une
 * minute, remise à zéro après une minute de fonctionnement). Les sorties sont ajoutées à `service.log` à côté de la base.
 */
export function runSupervisor(logFile: string): void {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const log = (line: string): void => {
    try {
      if (fs.existsSync(logFile) && fs.statSync(logFile).size > MAX_LOG_BYTES) {
        fs.renameSync(logFile, `${logFile}.1`);
      }
      fs.appendFileSync(logFile, line.endsWith('\n') ? line : `${line}\n`);
    } catch {
      // Journal indisponible : le service continue.
    }
  };
  let delay = 1000;
  let child: ReturnType<typeof spawn> | null = null;
  let stopping = false;

  const start = (): void => {
    const { file, args } = childCommand();
    const startedAt = Date.now();
    log(`[${new Date().toISOString()}] Démarrage du serveur : ${file} ${args.join(' ')}`);
    child = spawn(file, args, {
      env: { ...process.env, FASTBOARD_NO_OPEN: '1', FASTBOARD_SUPERVISED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout?.on('data', (chunk: Buffer) => log(chunk.toString('utf8')));
    child.stderr?.on('data', (chunk: Buffer) => log(chunk.toString('utf8')));
    child.on('exit', (code, signal) => {
      child = null;
      if (stopping) return;
      if (Date.now() - startedAt > STABLE_AFTER_MS) delay = 1000;
      log(`[${new Date().toISOString()}] Serveur arrêté (code ${code ?? '–'}${signal ? `, signal ${signal}` : ''}) : relance dans ${Math.round(delay / 1000)} s`);
      setTimeout(start, delay);
      delay = Math.min(delay * 2, 60_000);
    });
  };

  const stop = (): void => {
    stopping = true;
    log(`[${new Date().toISOString()}] Arrêt du service demandé.`);
    if (child) {
      child.once('exit', () => process.exit(0));
      child.kill('SIGTERM');
      setTimeout(() => process.exit(0), 10_000).unref();
    } else {
      process.exit(0);
    }
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  start();
}
