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

/** Priorités créées avec chaque projet (modifiables ensuite), de la plus haute à la plus basse. */
export const DEFAULT_PRIORITIES: ReadonlyArray<{ name: string; color: string; icon: string }> = [
  { name: 'Critique', color: '#dc2626', icon: 'pi pi-angle-double-up' },
  { name: 'Haute', color: '#f97316', icon: 'pi pi-angle-up' },
  { name: 'Moyenne', color: '#eab308', icon: 'pi pi-equals' },
  { name: 'Basse', color: '#3b82f6', icon: 'pi pi-angle-down' },
];

/** Raisons proposées pour une dépendance entre tickets (un texte libre reste possible). */
export const LINK_REASONS = ['Bloqué par', 'Bloque', 'Dépend de', 'Est requis par', 'Lié à', 'Duplique', 'Est dupliqué par', 'Cause', 'Est causé par'] as const;

/** Raison vue depuis le ticket lié (« A bloque B » se lit « B est bloqué par A »). */
export const LINK_INVERSE: Record<string, string> = {
  'Bloqué par': 'Bloque',
  Bloque: 'Bloqué par',
  'Dépend de': 'Est requis par',
  'Est requis par': 'Dépend de',
  'Lié à': 'Lié à',
  Duplique: 'Est dupliqué par',
  'Est dupliqué par': 'Duplique',
  Cause: 'Est causé par',
  'Est causé par': 'Cause',
};

/** Icônes proposées pour les priorités et les composants (PrimeIcons). */
export const PICKABLE_ICONS = [
  'pi pi-angle-double-up', 'pi pi-angle-up', 'pi pi-equals', 'pi pi-minus', 'pi pi-angle-down', 'pi pi-angle-double-down',
  'pi pi-exclamation-triangle', 'pi pi-exclamation-circle', 'pi pi-flag', 'pi pi-bolt', 'pi pi-star', 'pi pi-heart',
  'pi pi-desktop', 'pi pi-mobile', 'pi pi-tablet', 'pi pi-server', 'pi pi-database', 'pi pi-cloud', 'pi pi-globe', 'pi pi-code',
  'pi pi-cog', 'pi pi-wrench', 'pi pi-shield', 'pi pi-lock', 'pi pi-key', 'pi pi-user', 'pi pi-users', 'pi pi-palette',
  'pi pi-image', 'pi pi-file', 'pi pi-book', 'pi pi-chart-bar', 'pi pi-shopping-cart', 'pi pi-credit-card', 'pi pi-envelope',
  'pi pi-bell', 'pi pi-search', 'pi pi-box', 'pi pi-sitemap', 'pi pi-th-large', 'pi pi-compass', 'pi pi-map', 'pi pi-language',
] as const;

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
  linkTargetMax: 2000,
  subtaskTitleMax: 300,
  subtasksPerTicket: 100,
  linkReasonMax: 60,
  linksPerTicket: 50,
  listItemNameMax: 60,
  tokenDisplayNameMax: 60,
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
