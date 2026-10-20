/**
 * Tous les schémas de validation des requêtes. Ils servent à la fois à valider les routes et à générer
 * la documentation OpenAPI (`server/openapi`) : une seule source de vérité.
 */
import { parseRetentionRules } from '../../shared/backup.ts';
import { LIMITS, TICKET_STATUSES } from '../../shared/constants.ts';
import { isISODate } from '../../shared/dates.ts';
import { COLUMN_LABEL_MAX } from '../../shared/settings.ts';
import { LOCALES } from '../../shared/locales.ts';
import { LOG_LEVELS } from '../../shared/monitoring.ts';
import { isThemeId } from '../../shared/themes.ts';
import { z } from './validate.ts';

// --- Briques communes -----------------------------------------------------------------------------------------------

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur invalide (format #RRGGBB).');
const isoDate = z.string().refine(isISODate, 'Date invalide (AAAA-MM-JJ).').meta({ format: 'date', example: '2026-11-15' });
const id = z.number().int().positive();
const nullableId = id.nullable();
const percent = z.number().int().min(0).max(100);
const passwordField = z.string().min(8, 'Le mot de passe doit contenir au moins 8 caractères.').max(200);
const projectKey = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,8}$/, 'La clé contient 2 à 8 lettres ou chiffres.');

// --- Authentification et profil -------------------------------------------------------------------------------------

export const loginSchema = z.object({
  email: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(200),
});

export const profileSchema = z.object({
  name: z.string().trim().min(1).max(LIMITS.nameMax).optional(),
  theme: z.string().refine(isThemeId, 'Thème inconnu.').optional(),
  locale: z.enum(LOCALES).optional().describe("Langue de l'interface (`fr` ou `en`)."),
});

export const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordField,
});

// --- Jetons d'API ---------------------------------------------------------------------------------------------------

export const createTokenSchema = z.object({
  name: z.string().trim().min(1, 'Donnez un nom au jeton.').max(LIMITS.tokenNameMax),
  displayName: z
    .string()
    .trim()
    .max(LIMITS.tokenDisplayNameMax)
    .nullable()
    .default(null)
    .describe('Nom affiché dans l\'activité et l\'historique (« via … ») ; vide = `name`.')
    .meta({ example: 'Claude' }),
  scope: z.enum(['read', 'write']).default('write').describe('`read` : lecture seule. `write` : lecture et écriture.'),
  projectIds: z
    .array(id)
    .min(1)
    .max(100)
    .nullable()
    .default(null)
    .describe('Projets accessibles avec ce jeton ; `null` = tous ceux auxquels vous avez accès.'),
  expiresInDays: z.number().int().min(1).max(3650).nullable().default(90).describe("Durée de validité en jours ; `null` = n'expire jamais."),
});

export const updateTokenSchema = z.object({
  displayName: z.string().trim().max(LIMITS.tokenDisplayNameMax).nullable().optional().describe("Nom affiché ; `null` ou vide = `name`."),
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional().describe("Nouvelle validité à partir d'aujourd'hui ; `null` = n'expire jamais."),
});
export const revealTokenSchema = z.object({ password: z.string().min(1, 'Saisissez votre mot de passe.').max(200) });

// --- Sauvegardes et service ----------------------------------------------------------------------------------------

const scheduleSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('manual') }),
  z.object({ mode: z.literal('interval'), hours: z.number().int().min(1).max(24 * 31) }),
  z.object({
    mode: z.literal('daily'),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure invalide (HH:MM).'),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  }),
]);

const retentionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }),
  z.object({ mode: z.literal('count'), keep: z.number().int().min(1).max(10_000) }),
  z.object({ mode: z.literal('age'), days: z.number().int().min(1).max(36_500) }),
  z.object({ mode: z.literal('smart') }),
  z.object({
    mode: z.literal('custom'),
    rules: z
      .string()
      .trim()
      .max(300)
      .refine((rules) => parseRetentionRules(rules) !== null, 'Règles invalides : « durée:intervalle » séparés par des virgules, ex. 7D:0s,4W:1D,12M:1W.'),
  }),
]);

export const backupDestinationSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{6,32}$/).optional().describe('Absent pour une nouvelle destination.'),
  type: z.literal('folder'),
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean(),
  path: z.string().trim().min(1).max(500).describe('Dossier absolu sur la machine du serveur.'),
  schedule: scheduleSchema,
  incremental: z.boolean(),
  fullEvery: z.number().int().min(1).max(1000).describe("Archives par chaîne (complète + incrémentales) avant d'en recommencer une complète."),
  retention: retentionSchema,
});

export const backupConfigSchema = z.object({
  enabled: z.boolean(),
  destinations: z.array(backupDestinationSchema).max(20),
});

export const folderTestSchema = z.object({ path: z.string().trim().min(1).max(500) });

export const serviceActionSchema = z.object({
  action: z.enum(['install', 'uninstall', 'start', 'stop']),
  scope: z.enum(['user', 'system']).describe("user : à l'ouverture de session ; system : au démarrage de la machine (droits administrateur)."),
  dryRun: z.boolean().default(false).describe('Ne fait rien : retourne les commandes qui seraient exécutées.'),
});

// --- Administration -------------------------------------------------------------------------------------------------

export const createUserSchema = z.object({
  email: z.email().max(200),
  name: z.string().trim().min(1).max(LIMITS.nameMax),
  password: passwordField,
  roleId: id,
});

export const updateUserSchema = z.object({
  email: z.email().max(200).optional(),
  name: z.string().trim().min(1).max(LIMITS.nameMax).optional(),
  password: passwordField.optional(),
  roleId: id.optional(),
  isActive: z.boolean().optional(),
});

export const createRoleSchema = z.object({
  scope: z.enum(['global', 'project']),
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).default(''),
  permissions: z.array(z.string()).max(100),
});

export const updateRoleSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(300).optional(),
  permissions: z.array(z.string()).max(100).optional(),
});

// --- Projets, membres, catégories, livraisons -----------------------------------------------------------------------

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(LIMITS.nameMax),
  key: projectKey.optional().describe('Préfixe des tickets (ex. `APP`). Déduit du nom si absent.'),
  description: z.string().trim().max(2000).optional(),
});

export const columnSchema = z.object({
  status: z.enum(TICKET_STATUSES).describe('Statut des tickets de la colonne (fixe).'),
  label: z.string().trim().min(1).max(COLUMN_LABEL_MAX).describe('Nom affiché de la colonne.'),
  color,
  hidden: z.boolean().describe('Colonne masquée (impossible si elle contient des tickets, ou pour `done`).'),
});

export const settingsPatchSchema = z.object({
  autoMoveDone: z.boolean().optional().describe('Toutes les parts terminées → le ticket passe automatiquement dans la colonne « Terminé ».'),
  autoReopen: z.boolean().optional().describe('Une part rouverte sur un ticket terminé le repasse « En cours ».'),
  staleIndicator: z.boolean().optional().describe("Signale les tickets restés longtemps dans la même colonne."),
  staleDays: z.number().int().min(1).max(365).optional().describe("Jours sans changement de colonne avant d'être signalé."),
  confetti: z.boolean().optional().describe('Confettis quand un ticket arrive dans « Terminé ».'),
  columns: z.array(columnSchema).length(TICKET_STATUSES.length).optional().describe("Les six colonnes (une par statut), dans l'ordre d'affichage."),
});

export const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(LIMITS.nameMax).optional(),
  key: projectKey.optional(),
  description: z.string().trim().max(2000).optional(),
  archived: z.boolean().optional(),
  settings: settingsPatchSchema.optional().describe('Réglages du projet (fusionnés avec les réglages actuels).'),
});

export const memberSchema = z.object({ userId: id, roleId: id.describe('Identifiant d\'un rôle de projet (`GET /roles`).') });
export const memberRoleSchema = z.object({ roleId: id });

export const categorySchema = z.object({ name: z.string().trim().min(1).max(60), color });

const icon = z.string().regex(/^pi pi-[a-z0-9-]+$/, 'Icône invalide (classe PrimeIcons, ex. « pi pi-flag »).').meta({ example: 'pi pi-flag' });
export const listItemSchema = z.object({ name: z.string().trim().min(1).max(LIMITS.listItemNameMax), color, icon });
export const listItemPatchSchema = listItemSchema.partial().extend({
  position: z.number().int().min(0).max(1000).optional().describe('Nouveau rang dans la liste (0 = premier).'),
});
export const categoryPatchSchema = categorySchema.partial();

export const deliverySchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).optional(),
  startDate: isoDate,
  endDate: isoDate,
  color: color.optional(),
});
export const deliveryPatchSchema = deliverySchema.partial();

// --- Tickets et commentaires ----------------------------------------------------------------------------------------

export const createTicketSchema = z.object({
  title: z.string().trim().min(1, 'Le titre est obligatoire.').max(LIMITS.titleMax),
  description: z.string().max(LIMITS.descriptionMax).optional(),
  status: z.enum(TICKET_STATUSES).optional().describe('`backlog` par défaut.'),
  categoryId: nullableId.optional(),
  priorityId: nullableId.optional().describe('Priorité (`GET /projects/{id}` → `priorities`).'),
  componentIds: z.array(id).max(50).optional().describe('Composants du ticket (remplace la liste).'),
  deliveryId: nullableId.optional().describe('Livraison ciblée.'),
  startDate: isoDate.nullable().optional(),
  endDate: isoDate.nullable().optional(),
  progress: percent.optional().describe("Avancement manuel (%), utilisé quand le ticket n'a aucun assigné."),
  assigneeIds: z.array(id).max(50).optional().describe('Utilisateurs assignés (doivent être membres du projet).'),
});

export const updateTicketSchema = createTicketSchema.partial();

export const moveTicketSchema = z.object({
  status: z.enum(TICKET_STATUSES),
  /** Le ticket est inséré juste avant celui-ci ; `null` = en fin de colonne. */
  beforeId: id.nullable().default(null).describe('Insère le ticket juste avant celui-ci (même colonne cible) ; `null` = en fin de colonne.'),
});

export const subtaskSchema = z.object({
  title: z.string().trim().min(1).max(LIMITS.subtaskTitleMax),
  assigneeId: nullableId.optional().describe('Membre du projet chargé de la sous-tâche.'),
});
export const subtaskPatchSchema = subtaskSchema.partial().extend({
  done: z.boolean().optional(),
  position: z.number().int().min(0).max(1000).optional().describe('Nouveau rang (0 = première).'),
});
export const linkSchema = z.object({
  targetId: id.describe('Ticket lié (même projet).'),
  reason: z
    .string()
    .trim()
    .min(1)
    .max(LIMITS.linkReasonMax)
    .describe('Raison : « Bloqué par », « Bloque », « Dépend de », « Est requis par », « Lié à », « Duplique », « Est dupliqué par », « Cause », « Est causé par » ou texte libre.')
    .meta({ example: 'Bloqué par' }),
});

export const partSchema = z.object({
  done: z.boolean().optional().describe("La personne a terminé sa part."),
  progress: percent.optional().describe('Avancement personnel (%).'),
  note: z
    .string()
    .max(LIMITS.partNoteMax)
    .optional()
    .describe("Mission de la personne : ce qu'elle doit faire sur ce ticket (texte libre). Chaîne vide pour l'effacer."),
});

export const commentSchema = z.object({
  body: z.string().trim().min(1, 'Le message est vide.').max(LIMITS.commentMax),
  parentId: id.nullable().optional().describe("Identifiant du commentaire auquel on répond."),
});

export const commentEditSchema = z.object({ body: commentSchema.shape.body });

// --- Lecture filtrée (paramètres d'URL) -----------------------------------------------------------------------------

const csv = <T extends string>(allowed: readonly T[]) =>
  z
    .string()
    .transform((value) => value.split(',').map((entry) => entry.trim()).filter(Boolean))
    .pipe(z.array(z.enum(allowed as [T, ...T[]])));

export const ticketQuerySchema = z.object({
  status: csv(TICKET_STATUSES).optional().describe('Un ou plusieurs statuts séparés par des virgules.'),
  categoryId: z.coerce.number().int().positive().optional(),
  priorityId: z.coerce.number().int().positive().optional(),
  componentId: z.coerce.number().int().positive().optional(),
  deliveryId: z.union([z.literal('none'), z.coerce.number().int().positive()]).optional().describe('Identifiant de livraison, ou `none` pour les tickets sans livraison.'),
  assigneeId: z.union([z.literal('none'), z.literal('me'), z.coerce.number().int().positive()]).optional().describe('Identifiant d\'utilisateur, `me` (moi) ou `none` (non assignés).'),
  key: z.string().trim().max(20).optional().describe('Clé exacte d\'un ticket, ex. `APP-12`.'),
  q: z.string().trim().max(200).optional().describe('Recherche dans le titre, la description et la clé.'),
  updatedSince: z.string().datetime().optional().describe('Uniquement les tickets modifiés après cette date (ISO 8601).'),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const activityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.number().int().positive().optional().describe('Curseur : identifiant `nextBefore` retourné par la page précédente.'),
  group: csv(['ticket', 'comment', 'config', 'member'] as const).optional().describe('Un ou plusieurs groupes séparés par des virgules.'),
  userId: z.coerce.number().int().positive().optional().describe("Uniquement les actions de cet utilisateur."),
  viaApi: z.enum(['true', 'false']).transform((value) => value === 'true').optional().describe("`true` : uniquement les actions faites via un jeton d'API (équivaut à `source=api`)."),
  source: z.enum(['api', 'ui']).optional().describe("`api` : actions faites via un jeton d'API (agents, scripts) ; `ui` : actions faites depuis l'interface."),
  ticketId: z.coerce.number().int().positive().optional().describe('Uniquement les évènements de ce ticket.'),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1, 'Saisissez un texte à rechercher.').max(200).describe('Texte recherché (accents et casse ignorés), ou une clé de ticket « APP-12 ».'),
  type: csv(['projects', 'tickets', 'users'] as const).optional().describe('Types de résultats, séparés par des virgules (tous par défaut).'),
  limit: z.coerce.number().int().min(1).max(100).default(8).describe('Nombre de résultats par type.'),
});

export const uploadQuerySchema = z.object({
  name: z.string().trim().min(1).max(500).optional().describe("Nom du fichier (alternative à l'en-tête `X-File-Name`)."),
});

// --- Supervision (administration) -----------------------------------------------------------------------------------

export const monitoringQuerySchema = z.object({
  range: z.enum(['15m', '1h', '6h', '24h', '3d']).default('1h').describe('Fenêtre de temps analysée.'),
});

export const logQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  before: z.coerce.number().int().positive().optional().describe('Curseur : `nextBefore` de la page précédente.'),
  after: z.coerce.number().int().min(0).optional().describe('Uniquement les entrées plus récentes que cet identifiant (suivi en direct).'),
  level: csv(LOG_LEVELS).optional().describe('Un ou plusieurs niveaux séparés par des virgules.'),
  source: z.string().trim().max(200).optional().describe('Une ou plusieurs sources séparées par des virgules.'),
  userId: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(200).optional().describe('Recherche dans le message, les données et le nom de la personne.'),
  requestId: z.string().trim().max(40).optional().describe('Identifiant de requête (en-tête `X-Request-Id`).'),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
});

export type TicketQuery = z.infer<typeof ticketQuerySchema>;
export type LogQueryParams = z.infer<typeof logQuerySchema>;
export type ActivityQueryParams = z.infer<typeof activityQuerySchema>;
