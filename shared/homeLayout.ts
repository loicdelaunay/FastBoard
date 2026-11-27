/**
 * Disposition de l'Accueil, choisie par chacun : quels blocs, dans quel ordre, de quelle taille, avec leurs réglages.
 * Aux blocs de l'Accueil s'ajoutent des blocs de suivi facultatifs (tableau de bord personnel).
 */

export const HOME_BLOCK_TYPES = [
  // Blocs de l'Accueil
  'favorites',
  'assigned',
  'notifications',
  'recent',
  'bookmarks',
  // Blocs de suivi
  'status',
  'overdue',
  'upcoming',
  'project',
  'deliveries',
  'savedFilter',
  'activity',
] as const;
export type HomeBlockType = (typeof HOME_BLOCK_TYPES)[number];

/** Largeur : un tiers, la moitié, deux tiers ou toute la ligne (sur petit écran, toute la ligne). */
export const HOME_BLOCK_SIZES = ['third', 'half', 'twoThirds', 'full'] as const;
export type HomeBlockSize = (typeof HOME_BLOCK_SIZES)[number];
/** Hauteur de la liste du bloc : compacte, normale ou haute. */
export const HOME_BLOCK_HEIGHTS = ['compact', 'normal', 'tall'] as const;
export type HomeBlockHeight = (typeof HOME_BLOCK_HEIGHTS)[number];
export const ACTIVITY_GROUPS = ['all', 'ticket', 'comment'] as const;

export interface HomeBlockOptions {
  /** Nombre d'éléments montrés (listes). */
  limit?: number;
  /** Projet suivi (bloc « Projet », « Filtre enregistré ») ou limité (statuts, retards, échéances). */
  projectId?: number | null;
  /** Filtre enregistré (bloc « Filtre enregistré »). */
  filterId?: number | null;
  /** Échéances : dans combien de jours. */
  days?: number;
  /** Statuts : sans les tickets terminés. */
  hideDone?: boolean;
  /** Activité : type d'évènements. */
  group?: (typeof ACTIVITY_GROUPS)[number];
}

export interface HomeBlock {
  /** Identifiant du bloc dans la disposition (court, unique). */
  id: string;
  type: HomeBlockType;
  size: HomeBlockSize;
  height: HomeBlockHeight;
  /** Titre choisi (vide : celui du type). */
  title: string;
  options: HomeBlockOptions;
}

export interface HomeLayout {
  blocks: HomeBlock[];
}

export const HOME_LAYOUT_LIMITS = { blocks: 30, titleMax: 60, limitMin: 1, limitMax: 50, daysMin: 1, daysMax: 90, idMax: 24 } as const;

/** Présentation d'un type : libellé, icône, description (clés de traduction), taille et réglages par défaut. */
export interface HomeBlockInfo {
  label: string;
  icon: string;
  description: string;
  size: HomeBlockSize;
  options: HomeBlockOptions;
  /** Bloc de suivi (facultatif), par opposition aux blocs de l'Accueil d'origine. */
  tracking: boolean;
  /** Nombre d'éléments au plus (blocs qui ont l'option `limit`). */
  limitMax?: number;
}

export const HOME_BLOCK_INFO: Record<HomeBlockType, HomeBlockInfo> = {
  favorites: { label: 'Espaces favoris', icon: 'pi pi-star', description: 'Vos espaces de documentation, de tableaux blancs et vos projets favoris.', size: 'full', options: {}, tracking: false },
  assigned: { label: 'Assigné à moi', icon: 'pi pi-user', description: 'Les tickets ouverts dont votre part n’est pas finie, par échéance.', size: 'half', options: { limit: 20 }, tracking: false, limitMax: 50 },
  notifications: { label: 'Notifications importantes', icon: 'pi pi-bell', description: 'Mentions et assignations non lues.', size: 'half', options: { limit: 8 }, tracking: false, limitMax: 20 },
  recent: { label: 'Récemment modifié', icon: 'pi pi-history', description: 'Les notes, tableaux et tickets que vous avez modifiés.', size: 'half', options: { limit: 12 }, tracking: false, limitMax: 50 },
  bookmarks: { label: 'Documents favoris', icon: 'pi pi-bookmark', description: 'Les notes et images mises en favori.', size: 'half', options: { limit: 12 }, tracking: false, limitMax: 50 },
  status: { label: 'Mes tickets par statut', icon: 'pi pi-chart-bar', description: 'Combien de vos tickets dans chaque colonne, dans tous vos projets ou un seul.', size: 'third', options: { projectId: null, hideDone: false }, tracking: true },
  overdue: { label: 'En retard', icon: 'pi pi-exclamation-triangle', description: 'Vos tickets dont l’échéance est passée.', size: 'third', options: { projectId: null, limit: 10 }, tracking: true, limitMax: 50 },
  upcoming: { label: 'Échéances à venir', icon: 'pi pi-calendar-clock', description: 'Vos tickets qui arrivent à échéance dans les prochains jours.', size: 'third', options: { projectId: null, days: 7, limit: 10 }, tracking: true, limitMax: 50 },
  project: { label: 'Suivi d’un projet', icon: 'pi pi-th-large', description: 'L’avancement d’un projet et de sa livraison en cours.', size: 'third', options: { projectId: null }, tracking: true },
  deliveries: { label: 'Livraisons en cours', icon: 'pi pi-flag', description: 'Les livraisons en cours de vos projets : avancement et temps restant.', size: 'half', options: { limit: 8 }, tracking: true, limitMax: 30 },
  savedFilter: { label: 'Filtre enregistré', icon: 'pi pi-filter', description: 'Les tickets d’un filtre enregistré d’un projet (le vôtre ou un filtre partagé).', size: 'half', options: { projectId: null, filterId: null, limit: 10 }, tracking: true, limitMax: 50 },
  activity: { label: 'Activité récente', icon: 'pi pi-bolt', description: 'Ce qui se passe sur vos tickets et ce que vous faites, dans tous vos projets.', size: 'half', options: { limit: 10, group: 'all' }, tracking: true, limitMax: 50 },
};

let counter = 0;
/** Identifiant de bloc court et unique (dans une disposition). */
export function newBlockId(): string {
  counter += 1;
  return `b${Date.now().toString(36)}${counter.toString(36)}`.slice(0, HOME_LAYOUT_LIMITS.idMax);
}

export function newHomeBlock(type: HomeBlockType, id = newBlockId()): HomeBlock {
  const info = HOME_BLOCK_INFO[type];
  return { id, type, size: info.size, height: 'normal', title: '', options: { ...info.options } };
}

/** Disposition de départ : l'Accueil tel qu'il était. */
export function defaultHomeLayout(): HomeLayout {
  return { blocks: (['favorites', 'assigned', 'notifications', 'recent', 'bookmarks'] as const).map((type) => newHomeBlock(type, type)) };
}

const clamp = (value: unknown, min: number, max: number): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : undefined);
const positiveId = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null);

/** Disposition relue (base, adresse) : ce qui est inconnu ou invalide est écarté, le reste complété. */
export function normalizeHomeLayout(raw: unknown): HomeLayout {
  const source = raw && typeof raw === 'object' ? (raw as { blocks?: unknown }).blocks : undefined;
  if (!Array.isArray(source)) return defaultHomeLayout();
  const seen = new Set<string>();
  const blocks: HomeBlock[] = [];
  for (const entry of source.slice(0, HOME_LAYOUT_LIMITS.blocks)) {
    if (!entry || typeof entry !== 'object') continue;
    const value = entry as Record<string, unknown>;
    const type = value.type as HomeBlockType;
    if (!(HOME_BLOCK_TYPES as readonly string[]).includes(type)) continue;
    let id = typeof value.id === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(value.id) ? value.id : newBlockId();
    if (seen.has(id)) id = newBlockId();
    seen.add(id);
    const base = newHomeBlock(type, id);
    const options = (value.options && typeof value.options === 'object' ? value.options : {}) as Record<string, unknown>;
    const merged: HomeBlockOptions = { ...base.options };
    if ('limit' in base.options) merged.limit = clamp(options.limit, HOME_LAYOUT_LIMITS.limitMin, HOME_BLOCK_INFO[type].limitMax ?? HOME_LAYOUT_LIMITS.limitMax) ?? base.options.limit;
    if ('projectId' in base.options) merged.projectId = positiveId(options.projectId);
    if ('filterId' in base.options) merged.filterId = positiveId(options.filterId);
    if ('days' in base.options) merged.days = clamp(options.days, HOME_LAYOUT_LIMITS.daysMin, HOME_LAYOUT_LIMITS.daysMax) ?? base.options.days;
    if ('hideDone' in base.options) merged.hideDone = options.hideDone === true;
    if ('group' in base.options) merged.group = (ACTIVITY_GROUPS as readonly unknown[]).includes(options.group) ? (options.group as HomeBlockOptions['group']) : base.options.group;
    blocks.push({
      id,
      type,
      size: (HOME_BLOCK_SIZES as readonly unknown[]).includes(value.size) ? (value.size as HomeBlockSize) : base.size,
      height: (HOME_BLOCK_HEIGHTS as readonly unknown[]).includes(value.height) ? (value.height as HomeBlockHeight) : 'normal',
      title: typeof value.title === 'string' ? value.title.trim().slice(0, HOME_LAYOUT_LIMITS.titleMax) : '',
      options: merged,
    });
  }
  return { blocks };
}
