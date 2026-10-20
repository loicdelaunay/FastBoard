import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  DEFAULT_BACKUP_CONFIG,
  nextScheduledRun,
  selectRetained,
  type BackupConfigDTO,
  type BackupDestinationDTO,
  type BackupDestinationStatusDTO,
  type BackupKind,
  type BackupOverviewDTO,
  type BackupRunDTO,
} from '../../shared/backup.ts';
import { APP_VERSION } from '../../shared/changelog.ts';
import type { AppContext } from '../context.ts';
import { nowIso, type Db } from '../db/database.ts';
import { badRequest, conflict, notFound } from '../http/errors.ts';
import { ZipWriter } from './zip.ts';

const CONFIG_KEY = 'backups';
const SCHEDULER_TICK_MS = 60_000;
const KEPT_FAILURES = 50;

interface RunRow {
  id: number;
  destination_id: string;
  started_at: string;
  finished_at: string | null;
  status: BackupRunDTO['status'];
  kind: BackupKind;
  set_id: string | null;
  file: string | null;
  size: number | null;
  files: number | null;
  manifest: string | null;
  trigger: BackupRunDTO['trigger'];
  message: string | null;
}

/** Contenu d'une sauvegarde : chaque fichier connu et l'archive qui le contient. */
interface Manifest {
  app: string;
  version: string;
  createdAt: string;
  kind: BackupKind;
  setId: string;
  /** Archives nécessaires pour restaurer cette version (la complète d'abord, celle-ci en dernier). */
  archives: string[];
  files: Record<string, { size: number; mtime: number; archive: string }>;
}

function toRunDTO(row: RunRow): BackupRunDTO {
  return {
    id: row.id,
    destinationId: row.destination_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    kind: row.kind,
    setId: row.set_id,
    file: row.file,
    size: row.size,
    files: row.files,
    trigger: row.trigger,
    message: row.message,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------------

export function getBackupConfig(db: Db): BackupConfigDTO {
  const raw = db.get<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', CONFIG_KEY)?.value;
  if (!raw) return structuredClone(DEFAULT_BACKUP_CONFIG);
  try {
    const parsed = JSON.parse(raw) as Partial<BackupConfigDTO>;
    return { enabled: parsed.enabled === true, destinations: Array.isArray(parsed.destinations) ? parsed.destinations : [] };
  } catch {
    return structuredClone(DEFAULT_BACKUP_CONFIG);
  }
}

export type DestinationInput = Omit<BackupDestinationDTO, 'id'> & { id?: string };

/** Enregistre la configuration ; les destinations sans identifiant en reçoivent un. */
export function saveBackupConfig(ctx: AppContext, input: { enabled: boolean; destinations: DestinationInput[] }): BackupConfigDTO {
  const ids = new Set<string>();
  const destinations = input.destinations.map((destination): BackupDestinationDTO => {
    const id = destination.id ?? randomBytes(6).toString('hex');
    if (ids.has(id)) throw badRequest('Deux destinations portent le même identifiant.');
    ids.add(id);
    if (!path.isAbsolute(destination.path)) {
      throw badRequest(`Le dossier de « ${destination.name} » doit être un chemin absolu.`);
    }
    const dataDir = path.resolve(path.dirname(ctx.config.dbPath));
    const target = path.resolve(destination.path);
    if (target === dataDir || target.startsWith(dataDir + path.sep)) {
      throw badRequest('Choisissez un dossier en dehors du dossier des données de FastBoard.');
    }
    return { ...destination, id, path: target };
  });
  const config: BackupConfigDTO = { enabled: input.enabled, destinations };
  ctx.db.run(
    'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    CONFIG_KEY,
    JSON.stringify(config),
    nowIso(),
  );
  return config;
}

/** Vérifie qu'un dossier existe (ou peut être créé) et accepte l'écriture. */
export function testFolder(folder: string): { ok: boolean; message: string } {
  if (!path.isAbsolute(folder)) {
    return { ok: false, message: 'Le chemin doit être absolu.' };
  }
  try {
    fs.mkdirSync(folder, { recursive: true });
    const probe = path.join(folder, `.fastboard-test-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
    const stats = fs.statfsSync?.(folder);
    const free = stats ? Number(stats.bavail) * Number(stats.bsize) : null;
    return { ok: true, message: free === null ? 'Dossier accessible en écriture.' : `Dossier accessible en écriture (${formatSize(free)} libres).` };
  } catch (error) {
    return { ok: false, message: `Dossier inaccessible : ${(error as Error).message}` };
  }
}

function formatSize(bytes: number): string {
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// État
// ---------------------------------------------------------------------------------------------------------------------

function lastRun(db: Db, destinationId: string): RunRow | undefined {
  return db.get<RunRow>('SELECT * FROM backup_runs WHERE destination_id = ? ORDER BY id DESC LIMIT 1', destinationId);
}

export function backupOverview(ctx: AppContext): BackupOverviewDTO {
  const config = getBackupConfig(ctx.db);
  const now = Date.now();
  const statuses = config.destinations.map((destination): BackupDestinationStatusDTO => {
    const last = lastRun(ctx.db, destination.id);
    const success = ctx.db.get<{ at: string | null; n: number; size: number | null }>(
      "SELECT MAX(finished_at) AS at, COUNT(*) AS n, SUM(size) AS size FROM backup_runs WHERE destination_id = ? AND status = 'success'",
      destination.id,
    );
    const next = config.enabled && destination.enabled ? nextScheduledRun(destination.schedule, last ? Date.parse(last.started_at) : null, now) : null;
    return {
      destinationId: destination.id,
      lastRun: last ? toRunDTO(last) : null,
      lastSuccessAt: success?.at ?? null,
      nextRunAt: next === null ? null : new Date(Math.max(next, now)).toISOString(),
      archives: success?.n ?? 0,
      totalSize: success?.size ?? 0,
    };
  });
  const runs = ctx.db.all<RunRow>('SELECT * FROM backup_runs ORDER BY id DESC LIMIT 100').map(toRunDTO);
  return { config, statuses, runs };
}

// ---------------------------------------------------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------------------------------------------------

const running = new Set<string>();

function stamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** Fichiers d'un dossier, chemins relatifs avec des « / ». */
function walk(root: string, prefix = ''): Array<{ rel: string; abs: string; size: number; mtime: number }> {
  if (!fs.existsSync(root)) return [];
  const result: Array<{ rel: string; abs: string; size: number; mtime: number }> = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const abs = path.join(root, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      result.push(...walk(abs, rel));
    } else if (entry.isFile()) {
      const stats = fs.statSync(abs);
      result.push({ rel, abs, size: stats.size, mtime: Math.floor(stats.mtimeMs) });
    }
  }
  return result;
}

function parseManifest(raw: string | null): Manifest | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Manifest;
  } catch {
    return null;
  }
}

const README = `Sauvegarde FastBoard
====================

Chaque archive contient la base complète (fastboard.sqlite) et les pièces jointes ajoutées depuis l'archive précédente
de la même chaîne (sauvegarde incrémentale) ou toutes les pièces jointes (sauvegarde complète).
manifest.json liste, pour cette version, tous les fichiers et l'archive qui contient chacun d'eux.

Restaurer :
1. Arrêtez FastBoard.
2. Extrayez dans un dossier vide les archives listées dans manifest.json → "archives", dans l'ordre
   (la complète d'abord ; les fichiers des archives suivantes remplacent ceux des précédentes).
3. Remplacez le contenu du dossier des données (fastboard.sqlite, uploads/, secret.key) par les fichiers extraits,
   en supprimant au préalable fastboard.sqlite-wal et fastboard.sqlite-shm.
4. Redémarrez FastBoard.
`;

/** Lance une sauvegarde vers une destination ; une seule à la fois par destination. */
export async function runBackup(ctx: AppContext, destinationId: string, trigger: BackupRunDTO['trigger']): Promise<BackupRunDTO> {
  const config = getBackupConfig(ctx.db);
  const destination = config.destinations.find((entry) => entry.id === destinationId);
  if (!destination) {
    throw notFound('Destination de sauvegarde introuvable.');
  }
  if (running.has(destinationId)) {
    throw conflict('Une sauvegarde est déjà en cours vers cette destination.');
  }
  running.add(destinationId);
  const startedAt = new Date();
  const { lastInsertRowid: runId } = ctx.db.run(
    "INSERT INTO backup_runs (destination_id, started_at, status, kind, trigger) VALUES (?, ?, 'running', 'full', ?)",
    destinationId,
    startedAt.toISOString(),
    trigger,
  );
  const tempDb = path.join(os.tmpdir(), `fastboard-backup-${process.pid}-${runId}.sqlite`);
  let partFile: string | null = null;
  try {
    fs.mkdirSync(destination.path, { recursive: true });

    // Chaîne en cours : une incrémentale complète la dernière sauvegarde réussie tant que la chaîne est courte.
    const previous = ctx.db.get<RunRow>(
      "SELECT * FROM backup_runs WHERE destination_id = ? AND status = 'success' AND manifest IS NOT NULL ORDER BY id DESC LIMIT 1",
      destinationId,
    );
    const previousManifest = parseManifest(previous?.manifest ?? null);
    const chainIntact = previousManifest?.archives.every((archive) => fs.existsSync(path.join(destination.path, archive))) ?? false;
    const chainLength = previousManifest?.archives.length ?? 0;
    const kind: BackupKind = destination.incremental && previousManifest && chainIntact && chainLength < destination.fullEvery ? 'incremental' : 'full';
    const setId = kind === 'incremental' ? previousManifest!.setId : randomBytes(6).toString('hex');
    const fileName = `fastboard-${stamp(startedAt)}-${kind === 'full' ? 'full' : 'incr'}.zip`;
    const finalFile = path.join(destination.path, fileName);
    partFile = `${finalFile}.part`;

    // Instantané cohérent de la base (sans bloquer les écritures plus que nécessaire).
    fs.rmSync(tempDb, { force: true });
    ctx.db.run('VACUUM INTO ?', tempDb);

    const zip = new ZipWriter(partFile);
    const manifest: Manifest = {
      app: 'FastBoard',
      version: APP_VERSION,
      createdAt: startedAt.toISOString(),
      kind,
      setId,
      archives: [...(kind === 'incremental' ? previousManifest!.archives : []), fileName],
      files: {},
    };
    let added = 0;
    try {
      await zip.add('fastboard.sqlite', fs.readFileSync(tempDb), startedAt);
      added += 1;
      const keyFile = path.join(path.dirname(ctx.config.dbPath), 'secret.key');
      if (fs.existsSync(keyFile)) {
        await zip.add('secret.key', fs.readFileSync(keyFile));
        added += 1;
      }
      for (const file of walk(ctx.uploadsDir)) {
        const name = `uploads/${file.rel}`;
        const known = kind === 'incremental' ? previousManifest!.files[name] : undefined;
        if (known && known.size === file.size && known.mtime === file.mtime) {
          manifest.files[name] = known;
          continue;
        }
        await zip.add(name, fs.readFileSync(file.abs), new Date(file.mtime));
        manifest.files[name] = { size: file.size, mtime: file.mtime, archive: fileName };
        added += 1;
      }
      await zip.add('README.txt', Buffer.from(README, 'utf8'));
      await zip.add('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
      zip.close();
    } catch (error) {
      zip.abort();
      throw error;
    }
    fs.renameSync(partFile, finalFile);
    partFile = null;
    const size = fs.statSync(finalFile).size;
    ctx.db.run(
      "UPDATE backup_runs SET status = 'success', finished_at = ?, kind = ?, set_id = ?, file = ?, size = ?, files = ?, manifest = ? WHERE id = ?",
      nowIso(),
      kind,
      setId,
      fileName,
      size,
      added,
      JSON.stringify({ ...manifest, files: manifest.files }),
      runId,
    );
    ctx.logger.info('backup', `Sauvegarde ${kind === 'full' ? 'complète' : 'incrémentale'} réussie vers « ${destination.name} »`, { file: finalFile, size, files: added });
    applyRetention(ctx, destination);
  } catch (error) {
    const message = (error as Error).message;
    ctx.db.run("UPDATE backup_runs SET status = 'failed', finished_at = ?, message = ? WHERE id = ?", nowIso(), message.slice(0, 500), runId);
    ctx.logger.error('backup', `Échec de la sauvegarde vers « ${destination.name} » : ${message}`, { destination: destination.path });
    if (partFile) fs.rmSync(partFile, { force: true });
  } finally {
    fs.rmSync(tempDb, { force: true });
    running.delete(destinationId);
  }
  return toRunDTO(ctx.db.get<RunRow>('SELECT * FROM backup_runs WHERE id = ?', runId)!);
}

/**
 * Supprime les sauvegardes que la règle de conservation ne garde pas, sauf les archives dont une version gardée a
 * besoin (complète et incrémentales précédentes de sa chaîne).
 */
export function applyRetention(ctx: AppContext, destination: BackupDestinationDTO, now = Date.now()): number {
  const rows = ctx.db.all<RunRow>("SELECT * FROM backup_runs WHERE destination_id = ? AND status = 'success' AND file IS NOT NULL", destination.id);
  const kept = selectRetained(rows.map((row) => ({ id: row.id, at: Date.parse(row.started_at) })), destination.retention, now);
  const required = new Set<string>();
  for (const row of rows.filter((entry) => kept.has(entry.id))) {
    for (const archive of parseManifest(row.manifest)?.archives ?? [row.file!]) required.add(archive);
  }
  let removed = 0;
  for (const row of rows) {
    if (kept.has(row.id) || required.has(row.file!)) continue;
    fs.rmSync(path.join(destination.path, row.file!), { force: true });
    ctx.db.run('DELETE FROM backup_runs WHERE id = ?', row.id);
    removed += 1;
  }
  // Historique des échecs borné.
  ctx.db.run(
    `DELETE FROM backup_runs WHERE destination_id = ? AND status = 'failed' AND id NOT IN (
       SELECT id FROM backup_runs WHERE destination_id = ? AND status = 'failed' ORDER BY id DESC LIMIT ${KEPT_FAILURES})`,
    destination.id,
    destination.id,
  );
  if (removed > 0) {
    ctx.logger.info('backup', `${removed} ancienne(s) sauvegarde(s) supprimée(s) de « ${destination.name} » (conservation)`);
  }
  return removed;
}

/** Oublie l'historique d'une destination supprimée (les archives restent sur le disque). */
export function forgetDestinationRuns(db: Db, keepIds: string[]): void {
  if (keepIds.length === 0) {
    db.run("DELETE FROM backup_runs WHERE status != 'running'");
    return;
  }
  db.run(`DELETE FROM backup_runs WHERE status != 'running' AND destination_id NOT IN (${keepIds.map(() => '?').join(', ')})`, ...keepIds);
}

/** Planificateur : vérifie chaque minute les destinations dont la prochaine exécution est passée. */
export function startBackupScheduler(ctx: AppContext): () => void {
  // Une sauvegarde interrompue par un arrêt du serveur est marquée en échec.
  ctx.db.run("UPDATE backup_runs SET status = 'failed', finished_at = ?, message = 'Interrompue par un arrêt du serveur.' WHERE status = 'running'", nowIso());
  const tick = (): void => {
    const config = getBackupConfig(ctx.db);
    if (!config.enabled) return;
    const now = Date.now();
    for (const destination of config.destinations) {
      if (!destination.enabled || running.has(destination.id)) continue;
      const last = lastRun(ctx.db, destination.id);
      const next = nextScheduledRun(destination.schedule, last ? Date.parse(last.started_at) : null, now);
      if (next !== null && next <= now) {
        void runBackup(ctx, destination.id, 'schedule').catch(() => undefined);
      }
    }
  };
  const timer = setInterval(tick, SCHEDULER_TICK_MS);
  timer.unref();
  return () => clearInterval(timer);
}
