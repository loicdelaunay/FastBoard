/**
 * Sauvegardes : destinations, planification et règles de conservation (inspirées de Duplicati).
 * Partagé entre le serveur (exécution, élagage) et l'interface (formulaire, aperçu des règles).
 */

export type BackupDestinationType = 'folder';

export type BackupSchedule =
  | { mode: 'manual' }
  /** Toutes les `hours` heures depuis la dernière sauvegarde. */
  | { mode: 'interval'; hours: number }
  /** Chaque jour (ou seulement certains jours, 0 = dimanche) à l'heure `time` (« HH:MM », heure locale du serveur). */
  | { mode: 'daily'; time: string; weekdays: number[] };

export type RetentionPolicy =
  | { mode: 'all' }
  /** Garde les `keep` sauvegardes les plus récentes. */
  | { mode: 'count'; keep: number }
  /** Supprime les sauvegardes de plus de `days` jours. */
  | { mode: 'age'; days: number }
  /** Une par jour la dernière semaine, une par semaine le dernier mois, une par mois la dernière année. */
  | { mode: 'smart' }
  /** Règles « durée:intervalle » séparées par des virgules, ex. `7D:0s,4W:1D,12M:1W` (`U` = tout garder). */
  | { mode: 'custom'; rules: string };

export interface BackupDestinationDTO {
  id: string;
  type: BackupDestinationType;
  name: string;
  enabled: boolean;
  /** Dossier cible (chemin absolu sur la machine du serveur). */
  path: string;
  schedule: BackupSchedule;
  /** Sauvegardes incrémentales : seules les pièces jointes nouvelles sont ajoutées à l'archive. */
  incremental: boolean;
  /** Nombre maximal d'archives d'une chaîne (complète + incrémentales) avant d'en recommencer une complète. */
  fullEvery: number;
  retention: RetentionPolicy;
}

export interface BackupConfigDTO {
  enabled: boolean;
  destinations: BackupDestinationDTO[];
}

export type BackupRunStatus = 'running' | 'success' | 'failed';
export type BackupKind = 'full' | 'incremental';

export interface BackupRunDTO {
  id: number;
  destinationId: string;
  startedAt: string;
  finishedAt: string | null;
  status: BackupRunStatus;
  kind: BackupKind;
  /** Chaîne de sauvegardes : une complète et ses incrémentales. */
  setId: string | null;
  file: string | null;
  size: number | null;
  /** Nombre de fichiers ajoutés dans l'archive. */
  files: number | null;
  trigger: 'schedule' | 'manual';
  message: string | null;
}

export interface BackupDestinationStatusDTO {
  destinationId: string;
  lastRun: BackupRunDTO | null;
  lastSuccessAt: string | null;
  nextRunAt: string | null;
  /** Archives présentes et espace occupé. */
  archives: number;
  totalSize: number;
}

export interface BackupOverviewDTO {
  config: BackupConfigDTO;
  statuses: BackupDestinationStatusDTO[];
  runs: BackupRunDTO[];
}

export const DEFAULT_BACKUP_CONFIG: BackupConfigDTO = { enabled: false, destinations: [] };

export const SMART_RETENTION_RULES = '1W:1D,4W:1W,12M:1M';

const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  D: 86_400_000,
  W: 7 * 86_400_000,
  M: 30 * 86_400_000,
  Y: 365 * 86_400_000,
};

export interface RetentionRule {
  /** Âge maximal couvert par la règle (ms). */
  timeframe: number;
  /** Écart minimal entre deux sauvegardes gardées dans cette tranche (ms) ; 0 = toutes ; `null` = « U » (toutes). */
  interval: number | null;
}

function parseDuration(text: string): number | null {
  const match = /^(\d+)([smhDWMY])$/.exec(text.trim());
  if (!match) return null;
  return Number(match[1]) * UNIT_MS[match[2]!]!;
}

/** Analyse des règles personnalisées ; `null` si la syntaxe est invalide. */
export function parseRetentionRules(rules: string): RetentionRule[] | null {
  const parts = rules.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > 20) return null;
  const parsed: RetentionRule[] = [];
  for (const part of parts) {
    const [frame, interval] = part.split(':');
    const timeframe = frame ? parseDuration(frame) : null;
    if (timeframe === null || interval === undefined) return null;
    if (interval.trim() === 'U') {
      parsed.push({ timeframe, interval: null });
      continue;
    }
    const step = parseDuration(interval);
    if (step === null) return null;
    parsed.push({ timeframe, interval: step });
  }
  return parsed.sort((a, b) => a.timeframe - b.timeframe);
}

/**
 * Sauvegardes à conserver selon la règle (identifiants), la plus récente étant toujours gardée.
 * `versions` : sauvegardes réussies d'une destination, dans n'importe quel ordre.
 */
export function selectRetained<T extends { id: number; at: number }>(versions: T[], policy: RetentionPolicy, now: number): Set<number> {
  const sorted = [...versions].sort((a, b) => b.at - a.at);
  const kept = new Set<number>();
  if (sorted.length === 0) return kept;
  kept.add(sorted[0]!.id);

  switch (policy.mode) {
    case 'all':
      sorted.forEach((version) => kept.add(version.id));
      break;
    case 'count':
      sorted.slice(0, Math.max(1, policy.keep)).forEach((version) => kept.add(version.id));
      break;
    case 'age':
      sorted.filter((version) => now - version.at <= policy.days * 86_400_000).forEach((version) => kept.add(version.id));
      break;
    case 'smart':
    case 'custom': {
      const rules = parseRetentionRules(policy.mode === 'smart' ? SMART_RETENTION_RULES : policy.rules);
      if (!rules) {
        // Règle invalide : on ne supprime rien plutôt que de risquer de tout perdre.
        sorted.forEach((version) => kept.add(version.id));
        break;
      }
      let lower = 0;
      for (const rule of rules) {
        // Sauvegardes de la tranche, de la plus ancienne à la plus récente.
        const slice = sorted.filter((version) => now - version.at > lower && now - version.at <= rule.timeframe).reverse();
        let lastKept: number | null = null;
        for (const version of slice) {
          if (rule.interval === null || rule.interval === 0 || lastKept === null || version.at - lastKept >= rule.interval) {
            kept.add(version.id);
            lastKept = version.at;
          }
        }
        lower = rule.timeframe;
      }
      // Les sauvegardes plus récentes que « maintenant » (horloge décalée) sont gardées.
      sorted.filter((version) => version.at > now).forEach((version) => kept.add(version.id));
      break;
    }
  }
  return kept;
}

/** Prochaine exécution planifiée après `lastRunAt` (ou maintenant si jamais lancée) ; `null` = manuelle. */
export function nextScheduledRun(schedule: BackupSchedule, lastRunAt: number | null, now: number): number | null {
  if (schedule.mode === 'manual') return null;
  if (schedule.mode === 'interval') {
    return lastRunAt === null ? now : lastRunAt + schedule.hours * 3_600_000;
  }
  const [hours, minutes] = schedule.time.split(':').map(Number);
  const from = new Date(lastRunAt ?? now - 86_400_000 * 8);
  // Premier créneau strictement postérieur à la dernière exécution.
  for (let day = 0; day <= 8; day += 1) {
    const slot = new Date(from.getFullYear(), from.getMonth(), from.getDate() + day, hours ?? 0, minutes ?? 0, 0, 0);
    if (slot.getTime() <= from.getTime()) continue;
    if (schedule.weekdays.length > 0 && !schedule.weekdays.includes(slot.getDay())) continue;
    if (lastRunAt === null && slot.getTime() < now) continue;
    return slot.getTime();
  }
  return null;
}
