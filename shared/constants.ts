/** Constantes métier partagées entre le serveur et le client. */

export const TICKET_STATUSES = ['backlog', 'todo', 'in_progress', 'blocked', 'review', 'done'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export interface StatusMeta {
  label: string;
  color: string;
  icon: string;
}

export const STATUS_META: Record<TicketStatus, StatusMeta> = {
  backlog: { label: 'Backlog', color: '#94a3b8', icon: 'pi pi-inbox' },
  todo: { label: 'À faire', color: '#38bdf8', icon: 'pi pi-list' },
  in_progress: { label: 'En cours', color: '#6366f1', icon: 'pi pi-spinner' },
  blocked: { label: 'Bloqué', color: '#ef4444', icon: 'pi pi-ban' },
  review: { label: 'À tester', color: '#f59e0b', icon: 'pi pi-eye' },
  done: { label: 'Terminé', color: '#22c55e', icon: 'pi pi-check-circle' },
};

export function isTicketStatus(value: unknown): value is TicketStatus {
  return typeof value === 'string' && (TICKET_STATUSES as readonly string[]).includes(value);
}

/** Catégories créées par défaut dans un nouveau projet (modifiables ensuite). */
export const DEFAULT_CATEGORIES: ReadonlyArray<{ name: string; color: string }> = [
  { name: 'Fonctionnalité', color: '#6366f1' },
  { name: 'Bug', color: '#ef4444' },
  { name: 'Tâche', color: '#0ea5e9' },
];

export const LIMITS = {
  tokenNameMax: 60,
  titleMax: 200,
  descriptionMax: 20_000,
  commentMax: 5_000,
  partNoteMax: 2_000,
  nameMax: 100,
  projectKeyMax: 8,
  avatarMaxBytes: 512 * 1024,
  /** Taille maximale d'une pièce jointe (le serveur peut la réduire via `FASTBOARD_MAX_UPLOAD_MB`). */
  attachmentMaxBytes: 25 * 1024 * 1024,
  attachmentsPerTicket: 30,
  attachmentNameMax: 200,
} as const;

/** En-tête portant le nom (encodé avec `encodeURIComponent`) d'un fichier envoyé en corps brut. */
export const FILE_NAME_HEADER = 'x-file-name';

/** Nom de l'en-tête transmis par le client pour reconnaître ses propres évènements temps réel. */
export const CLIENT_ID_HEADER = 'x-client-id';

/**
 * Compte avec lequel l'onglet croit être connecté. Si le cookie de session appartient à un autre compte
 * (connexion dans un autre onglet), le serveur répond 401 `session_changed` au lieu d'agir en son nom.
 */
export const USER_ID_HEADER = 'x-user-id';
