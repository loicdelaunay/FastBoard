/** Installation de FastBoard comme service (démarrage automatique et relance en arrière-plan). */

export type ServicePlatform = 'windows' | 'linux' | 'macos' | 'other';

/** `user` : au démarrage de la session de l'utilisateur ; `system` : au démarrage de la machine (droits administrateur). */
export type ServiceScope = 'user' | 'system';

export interface ServiceFileDTO {
  path: string;
  content: string;
}

export interface ServicePlanDTO {
  scope: ServiceScope;
  /** Fichiers écrits par l'installation. */
  files: ServiceFileDTO[];
  /** Commandes exécutées, dans l'ordre (à lancer à la main si l'installation automatique n'a pas les droits). */
  install: string[];
  uninstall: string[];
  start: string[];
  stop: string[];
}

export interface ServiceStatusDTO {
  platform: ServicePlatform;
  supported: boolean;
  /** Nom du service ou de la tâche planifiée. */
  name: string;
  installed: boolean;
  installedScope: ServiceScope | null;
  /** État rapporté par le système (« Running », « active »…), quand il est connu. */
  state: string | null;
  /** Le processus courant dispose des droits administrateur (nécessaires pour `system`). */
  elevated: boolean;
  /** Le serveur courant tourne déjà sous le service. */
  supervised: boolean;
  runningAsExecutable: boolean;
  /** Programme lancé par le service. */
  command: string;
  /** Variables d'environnement reprises dans le service. */
  env: Record<string, string>;
  logFile: string;
  warnings: string[];
  plans: ServicePlanDTO[];
}

export interface ServiceActionResultDTO {
  ok: boolean;
  dryRun: boolean;
  commands: string[];
  output: string;
  status: ServiceStatusDTO;
}
