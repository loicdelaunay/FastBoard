import type { AppConfig } from './config.ts';
import type { Db } from './db/database.ts';
import type { Logger } from './monitoring/logger.ts';
import type { Metrics } from './monitoring/metrics.ts';
import type { Hub } from './realtime/hub.ts';
import type { SecretBox } from './auth/secretBox.ts';

export interface AppContext {
  config: AppConfig;
  db: Db;
  hub: Hub;
  logger: Logger;
  metrics: Metrics;
  /** Dossier (existant) où sont stockées les pièces jointes. */
  uploadsDir: string;
  /** Chiffre les secrets réaffichables (jetons d'API). */
  secrets: SecretBox;
}

/** Auteur d'une action, transmis aux évènements temps réel. */
export interface Actor {
  userId: number | null;
  /** Identifiant d'onglet du client à l'origine de l'action (en-tête `x-client-id`). */
  origin: string | null;
  /** Nom du jeton d'API quand l'action vient de l'API (agent, script) et non d'une session de l'interface. */
  via?: string | null;
}
