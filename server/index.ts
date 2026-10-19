import { exec } from 'node:child_process';
import fs from 'node:fs';
import { startServer, type RunningServer } from './app.ts';
import { readAsset, runningAsExecutable } from './runtime.ts';

if (runningAsExecutable) {
  // Dans l'exécutable il n'y a pas d'option `--no-warnings` : on masque l'avertissement « SQLite est expérimental ».
  const emitWarning = process.emitWarning.bind(process) as (...args: unknown[]) => void;
  process.emitWarning = ((warning: unknown, ...args: unknown[]) => {
    const type = typeof args[0] === 'string' ? args[0] : (args[0] as { type?: string } | undefined)?.type;
    if (type !== 'ExperimentalWarning') {
      emitWarning(warning, ...args);
    }
  }) as typeof process.emitWarning;
}

/** Laisse la fenêtre ouverte pour qu'une erreur reste lisible quand l'exécutable est lancé par double-clic. */
function exitAfterKey(code: number): void {
  if (!runningAsExecutable || !process.stdin.isTTY) {
    process.exit(code);
  }
  console.error('\nAppuyez sur Entrée pour fermer cette fenêtre.');
  process.stdin.resume();
  process.stdin.once('data', () => process.exit(code));
}

async function main(): Promise<void> {
  let running: RunningServer;
  try {
    running = await startServer();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(`Le port ${process.env.PORT ?? 3000} est déjà utilisé. Arrêtez l'autre processus ou définissez PORT.`);
    } else {
      console.error(error);
    }
    exitAfterKey(1);
    return;
  }
  const { config } = running.ctx;
  const url = `http://localhost:${running.port}`;

  console.log(`FastBoard prêt sur ${url}  (base : ${config.dbPath})`);
  if (running.createdSuperAdmin) {
    console.log(`Compte super administrateur créé : ${config.superAdmin.email} / ${config.superAdmin.password} — pensez à changer ce mot de passe.`);
  }
  if (runningAsExecutable) {
    console.log('Ctrl+C (ou la fermeture de cette fenêtre) arrête le serveur.');
    // Ouvre l'interface dans le navigateur par défaut (FASTBOARD_NO_OPEN=1 pour l'éviter).
    if (process.env.FASTBOARD_NO_OPEN !== '1') {
      const command = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
      exec(command, () => undefined);
    }
  } else if (config.isProd && !fs.existsSync(`${config.distDir}/index.html`)) {
    console.warn("Le dossier dist/ est introuvable : lancez d'abord « npm run build ».");
  }
  if (runningAsExecutable && !readAsset('dist/index.html')) {
    console.warn("Interface introuvable dans l'exécutable : il a été construit sans « npm run build ».");
  }

  /** Une erreur non rattrapée est inscrite au journal (et écrite en base) avant l'arrêt du processus, comme le fait Node par défaut. */
  function crash(kind: string, error: unknown): void {
    running.ctx.logger.error('system', `${kind} : ${error instanceof Error ? error.message : String(error)}`, { stack: error instanceof Error ? error.stack : undefined });
    running.ctx.logger.flush();
    console.error(error);
    exitAfterKey(1);
  }
  process.on('uncaughtException', (error) => crash('Exception non rattrapée', error));
  process.on('unhandledRejection', (reason) => crash('Promesse rejetée non gérée', reason));

  let stopping = false;
  async function shutdown(signal: string): Promise<void> {
    if (stopping) {
      return;
    }
    stopping = true;
    console.log(`\n${signal} reçu, arrêt en cours…`);
    await running.close();
    process.exit(0);
  }

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
