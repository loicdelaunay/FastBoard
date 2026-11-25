/**
 * Tous les schémas de validation des requêtes. Ils servent à la fois à valider les routes et à générer
 * la documentation OpenAPI (`server/openapi`) : une seule source de vérité.
 */
import { AI_CONTEXT_KINDS, AI_LIMITS, RESERVED_REASONING_PARAMS } from '../../shared/ai.ts';
import { parseRetentionRules } from '../../shared/backup.ts';
import { BOARD_ICON_LIMITS, BOARD_LIMITS, BOARD_SHARE_AUDIENCES, BOARD_SHARE_LIMITS, BOARD_SHARE_ROLES } from '../../shared/boards.ts';
import { LIMITS, NOTIFICATION_LEVELS, TICKET_STATUSES } from '../../shared/constants.ts';
import { isISODate } from '../../shared/dates.ts';
import { DOC_COMMENT_LIMITS } from '../../shared/docComments.ts';
import { DOC_FOLDER_ICONS, DOC_LIMITS, DOC_ROLES, DOC_SITE_VISIBILITIES, normalizeImageFolder } from '../../shared/docs.ts';
import { LDAP_LIMITS, LDAP_PROFILES, LDAP_SECURITY, LDAP_USER_TOKEN } from '../../shared/ldap.ts';
import { RAG_FORMATS, RAG_LIMITS } from '../../shared/rag.ts';
import { VERSION_TAG_LIMITS } from '../../shared/versionTags.ts';
import { COLUMN_LABEL_MAX, SORT_FIELDS } from '../../shared/settings.ts';
import { LOCALES } from '../../shared/locales.ts';
import { LOG_LEVELS } from '../../shared/monitoring.ts';
import { CUSTOM_FIELD_LIMITS, CUSTOM_FIELD_TYPES, TICKET_FIELDS } from '../../shared/ticketFields.ts';
import { APPEARANCE_LIMITS, READING_WIDTHS, SURFACE_PALETTES, THEME_COLORS, THEME_PRESETS, isFontFamily, isThemeId, type ThemeColorKey } from '../../shared/themes.ts';
import { GROUP_LIMITS, GROUP_MEMBER_ROLES, GROUP_SPACE_ROLES } from '../../shared/groups.ts';
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
  email: z.string().trim().min(1).max(200).describe('Adresse e-mail, ou identifiant de l’annuaire quand la connexion LDAP est activée.'),
  password: z.string().min(1).max(200),
});

const fontFamily = z.string().max(APPEARANCE_LIMITS.fontMax).refine(isFontFamily, 'Police invalide.');
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const themeColorsSchema = z
  .object(Object.fromEntries(THEME_COLORS.map((entry) => [entry.key, hexColor.optional()])) as Record<ThemeColorKey, z.ZodOptional<typeof hexColor>>)
  .describe('Couleurs réglées une à une (#RRGGBB) : interface (`background`, `panel`, `text`…) et rendu Markdown (`mdH1`, `mdLink`, `mdCodeBg`…).');
const themeFontsSchema = z.object({ body: fontFamily, heading: fontFamily, mono: fontFamily, doc: fontFamily });

/** Thème personnalisé publié dans la bibliothèque du site (sans identifiant : il en reçoit un). */
export const sharedThemeSchema = z.object({
  theme: z.object({
    label: z.string().trim().min(1).max(APPEARANCE_LIMITS.labelMax),
    mode: z.enum(['light', 'dark']),
    preset: z.enum(THEME_PRESETS as [string, ...string[]]),
    primary: hexColor,
    surface: z.union([z.enum(SURFACE_PALETTES), hexColor]),
    colors: themeColorsSchema.default({}),
    fonts: themeFontsSchema.default({ body: '', heading: '', mono: '', doc: '' }),
  }),
});

export const profileSchema = z.object({
  name: z.string().trim().min(1).max(LIMITS.nameMax).optional(),
  theme: z
    .string()
    .max(60)
    .refine((value) => isThemeId(value) || /^custom-[a-z0-9]{4,24}$/.test(value), 'Thème inconnu.')
    .optional()
    .describe('Thème prédéfini, ou identifiant `custom-…` d’un de vos thèmes personnalisés.'),
  appearance: z
    .object({
      customThemes: z
        .array(
          z.object({
            id: z.string().regex(/^custom-[a-z0-9]{4,24}$/),
            label: z.string().trim().min(1).max(APPEARANCE_LIMITS.labelMax),
            mode: z.enum(['light', 'dark']),
            preset: z.enum(THEME_PRESETS as [string, ...string[]]),
            primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
            surface: z.union([z.enum(SURFACE_PALETTES), z.string().regex(/^#[0-9a-fA-F]{6}$/)]),
            colors: themeColorsSchema.default({}),
            fonts: themeFontsSchema.default({ body: '', heading: '', mono: '', doc: '' }),
          }),
        )
        .max(APPEARANCE_LIMITS.themes),
      fonts: z.object({
        body: fontFamily,
        heading: fontFamily,
        mono: fontFamily,
        size: z.number().int().min(APPEARANCE_LIMITS.sizeMin).max(APPEARANCE_LIMITS.sizeMax),
        doc: fontFamily.default(''),
        docSize: z.union([z.literal(0), z.number().int().min(APPEARANCE_LIMITS.docSizeMin).max(APPEARANCE_LIMITS.docSizeMax)]).default(0).describe('Taille du texte des notes en pixels (0 : comme l’interface).'),
      }),
      reading: z.enum(READING_WIDTHS).default('screen').describe('Largeur du texte des notes : `screen` centré sur l’écran, `column` centré dans sa colonne, `full` sans marges.'),
    })
    .optional()
    .describe('Thèmes personnalisés (couleurs, style) et polices de l’interface (remplace l’ensemble).'),
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
  completeStatuses: z.array(z.enum(TICKET_STATUSES)).max(6).optional().describe('Colonnes où un ticket compte pour 100 % (« done » toujours inclus).'),
  columnSort: z
    .record(z.enum(TICKET_STATUSES), z.object({ field: z.enum(SORT_FIELDS), direction: z.enum(['asc', 'desc']) }))
    .optional()
    .describe('Tri automatique des cartes par colonne (absente = ordre manuel). Champs : priority, dueDate, title, number, createdAt, updatedAt, progress.'),
  deliveryAlert: z.boolean().optional().describe('Pastille colorée sur les tickets non terminés dont la livraison approche.'),
  deliveryWarnDays: z.number().int().min(0).max(365).optional().describe('Jours restants à partir desquels la pastille passe à l’orange.'),
  deliveryDangerDays: z.number().int().min(0).max(365).optional().describe('Jours restants à partir desquels la pastille passe au rouge.'),
  confetti: z.boolean().optional().describe('Confettis quand un ticket arrive dans « Terminé ».'),
  hideZeroProgress: z.boolean().optional().describe('Masque la barre d’avancement des tickets à 0 %.'),
  allowNewComponents: z.boolean().optional().describe('Les personnes qui modifient les tickets peuvent créer un composant depuis un ticket.'),
  hideDoneUnassigned: z.boolean().optional().describe('Analyseur : ne pas compter les tickets terminés dans « Non assigné » (charge par personne).'),
  progressReminder: z.boolean().optional().describe('Rappel d’avancement : sur les tickets « En cours » d’une livraison en cours, signale les personnes qui n’ont pas mis à jour leur avancement (pourcentage ou commentaire).'),
  progressReminderDays: z.number().int().min(1).max(30).optional().describe('Jours sans mise à jour de l’avancement avant le rappel (2 par défaut).'),
  ticketFields: z.partialRecord(z.enum(TICKET_FIELDS), z.boolean()).optional().describe('Champs standard affichés dans les tickets (`false` = masqué, les valeurs sont conservées).'),
  customFields: z
    .array(
      z.object({
        id: z.string().regex(/^cf_[a-z0-9]{1,24}$/).describe('Identifiant stable `cf_…` (choisi par le client).'),
        label: z.string().trim().min(1).max(CUSTOM_FIELD_LIMITS.labelMax),
        type: z.enum(CUSTOM_FIELD_TYPES),
        options: z.array(z.string().trim().min(1).max(CUSTOM_FIELD_LIMITS.optionMax)).max(CUSTOM_FIELD_LIMITS.options).default([]),
        showOnCard: z.boolean().default(false),
        allowNewOptions: z.boolean().default(false).describe('Listes : ajout de choix depuis les tickets.'),
      }),
    )
    .max(CUSTOM_FIELD_LIMITS.fields)
    .optional()
    .describe('Champs personnalisés des tickets (remplace la liste). Types : text, longtext, number, date, select, multiselect, checkbox, url, user.'),
  columns: z.array(columnSchema).length(TICKET_STATUSES.length).optional().describe("Les six colonnes (une par statut), dans l'ordre d'affichage."),
});

export const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(LIMITS.nameMax).optional(),
  key: projectKey.optional(),
  description: z.string().trim().max(2000).optional(),
  archived: z.boolean().optional(),
  settings: settingsPatchSchema.optional().describe('Réglages du projet (fusionnés avec les réglages actuels).'),
  rag: z.boolean().optional().describe('Recherche sémantique (RAG) : indexer ses tickets pour l’assistant IA (désactivé par défaut ; l’administrateur règle le modèle dans Administration → IA).'),
});

export const memberSchema = z.object({ userId: id, roleId: id.describe('Identifiant d\'un rôle de projet (`GET /roles`).') });
export const memberRoleSchema = z.object({ roleId: id });

// --- Groupes ---------------------------------------------------------------------------------------------------------

const groupColor = z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().describe('Couleur #RRGGBB du groupe, ou `null`.');
export const groupSchema = z.object({
  name: z.string().trim().min(1).max(GROUP_LIMITS.nameMax),
  description: z.string().max(GROUP_LIMITS.descriptionMax).default(''),
  color: groupColor.default(null),
  memberIds: z.array(id).max(GROUP_LIMITS.membersMax).default([]).describe('Personnes à mettre dans le groupe (qui le crée en est gestionnaire).'),
});
export const groupPatchSchema = z.object({
  name: z.string().trim().min(1).max(GROUP_LIMITS.nameMax).optional(),
  description: z.string().max(GROUP_LIMITS.descriptionMax).optional(),
  color: groupColor.optional(),
});
export const groupMemberSchema = z.object({ role: z.enum(GROUP_MEMBER_ROLES).default('member').describe('`manager` : gère le groupe ; `member` : en fait partie.') });
export const projectGroupSchema = z.object({ roleId: id.describe('Rôle de projet donné aux membres du groupe (pas propriétaire).') });
export const spaceGroupSchema = z.object({ role: z.enum(GROUP_SPACE_ROLES).describe('Rôle des membres du groupe dans l’espace : `reader` ou `editor`.') });

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
  parentId: nullableId.optional().describe('Ticket parent : fait de ce ticket un sous-ticket (même projet, un seul niveau). `null` pour le détacher.'),
  progressFromChildren: z.boolean().optional().describe('Avec des sous-tickets : l’avancement suit le leur (vrai par défaut) ; `false` : avancement propre au ticket.'),
  customFields: z
    .record(z.string().regex(/^cf_[a-z0-9]{1,24}$/), z.union([z.string().max(5_000), z.number(), z.boolean(), z.array(z.string().max(60)).max(50), z.null()]))
    .optional()
    .describe('Champs personnalisés du projet (`settings.customFields`) : `{ <id>: valeur }`, fusionnés avec les valeurs actuelles ; `null` efface. Texte, nombre, date AAAA-MM-JJ, booléen, choix, liste de choix ou identifiant de personne selon le type.'),
});

export const updateTicketSchema = createTicketSchema.partial();

export const moveTicketSchema = z.object({
  status: z.enum(TICKET_STATUSES),
  /** Le ticket est inséré juste avant celui-ci ; `null` = en fin de colonne. */
  beforeId: id.nullable().default(null).describe('Insère le ticket juste avant celui-ci (même colonne cible) ; `null` = en fin de colonne.'),
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

export const partCreateSchema = z.object({
  note: z.string().max(LIMITS.partNoteMax).optional().describe("Ce qu'il y a à faire (texte libre)."),
  userId: nullableId.optional().describe('Membre du projet chargé de la ligne (facultatif).'),
});
export const partPatchSchema = partCreateSchema.extend({
  done: z.boolean().optional().describe('Ligne terminée. `progress` à 100 revient au même ; donné aussi, c’est `progress` qui décide.'),
  progress: percent.optional().describe('Avancement de la ligne (%).'),
  position: z.number().int().min(0).max(1000).optional().describe('Nouveau rang (0 = première).'),
});

export const transferTicketSchema = z.object({
  projectId: id.describe('Projet de destination.'),
  status: z.enum(TICKET_STATUSES).default('backlog').describe('Colonne de destination.'),
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

const aiContextSchema = z
  .object({
    projectId: id.nullable().optional(),
    ticketId: id.nullable().optional(),
    docSpaceId: id.nullable().optional().describe('Espace de documentation ouvert.'),
    docNodeId: id.nullable().optional().describe('Note ouverte.'),
    boardId: id.nullable().optional().describe('Tableau blanc ouvert.'),
    items: z
      .array(z.object({ kind: z.enum(AI_CONTEXT_KINDS), id }))
      .max(AI_LIMITS.contextItems)
      .optional()
      .describe('Autres projets, tickets, espaces ou notes ajoutés au contexte.'),
  })
  .default({});

export const aiChatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(AI_LIMITS.messageChars),
        images: z
          .array(z.string().max(AI_LIMITS.imageChars).regex(/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/, 'Image invalide (PNG, JPEG, WebP ou GIF en base64).'))
          .max(AI_LIMITS.imagesPerMessage)
          .optional(),
        files: z
          .array(
            z.object({
              name: z.string().trim().min(1).max(255),
              type: z.string().max(200).default(''),
              text: z.string().max(AI_LIMITS.fileChars),
              pages: z.number().int().positive().max(100_000).optional(),
              truncated: z.boolean().optional(),
            }),
          )
          .max(AI_LIMITS.filesPerMessage)
          .optional()
          .describe('Fichiers joints : texte extrait par l’interface (CSV, PDF, texte…), envoyé à tous les modèles.'),
      }),
    )
    .min(1)
    .max(AI_LIMITS.messages)
    .refine((messages) => messages.at(-1)?.role === 'user', 'Le dernier message doit venir de la personne.'),
  context: aiContextSchema,
  allowWrite: z.boolean().default(false).describe("Autorise l'assistant à modifier (si la personne en a le droit)."),
  writeMode: z.enum(['apply', 'propose']).default('apply').describe('`apply` : modifications faites directement ; `propose` : proposées, à valider par la personne.'),
  model: z.string().max(300).optional().describe('Référence d’un modèle mis à disposition (`GET /ai/models` → `ref`) ; absent = modèle par défaut.'),
  reasoning: z.string().max(40).optional().describe('Réglage de réflexion : identifiant d’un réglage du modèle (`GET /ai/models` → `reasoningOptions`), ex. `high` ; absent = réglage du fournisseur.'),
  canRender: z
    .boolean()
    .default(false)
    .describe("Le client sait dessiner des images pour le modèle : il répond aux évènements `render` par `POST /ai/renders/{id}` (vue d'un tableau blanc, image réduite)."),
});

/** Image dessinée par le panneau à la demande du serveur, ou la raison de son échec. */
export const aiRenderResultSchema = z.union([
  z.object({ image: z.string().max(AI_LIMITS.imageChars).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, 'Image invalide (PNG, JPEG ou WebP en base64).').describe('Image en adresse `data:`.') }),
  z.object({ error: z.string().trim().min(1).max(500).describe('Pourquoi l’image n’a pas pu être dessinée.') }),
]);

const aiModelsSchema = z
  .array(
    z.object({
      id: z.string().trim().min(1).max(200),
      label: z.string().trim().max(80).default(''),
      vision: z.boolean().default(false),
      contextWindow: z.number().int().min(1_000).max(10_000_000).default(128_000).describe('Taille du contexte en jetons.'),
      reasoning: z.boolean().default(false).describe('Le modèle a des réglages de réflexion.'),
      reasoningOptions: z
        .array(
          z.object({
            id: z.string().regex(/^[\w-]{1,40}$/, 'Identifiant de réglage invalide (lettres, chiffres, tirets).'),
            label: z.string().trim().max(40).default('').describe('Nom affiché ; vide : le nom habituel de l’identifiant.'),
            params: z
              .record(z.string(), z.unknown())
              .refine((params) => JSON.stringify(params).length <= AI_LIMITS.reasoningParamsChars, 'Paramètres de réflexion trop longs.')
              .refine((params) => !Object.keys(params).some((key) => RESERVED_REASONING_PARAMS.includes(key)), 'Un réglage de réflexion ne peut pas remplacer model, messages, tools, tool_choice, stream ni n.')
              .describe('Paramètres ajoutés à la requête chat/completions, ex. `{ "reasoning_effort": "high" }`.'),
          }),
        )
        .max(AI_LIMITS.reasoningOptions)
        .optional()
        .describe('Réglages de réflexion proposés dans le panneau ; absent : les quatre niveaux d’OpenAI (reasoning_effort).'),
    }),
  )
  .max(AI_LIMITS.models);

export const aiSettingsSchema = z.object({
  enabled: z.boolean(),
  providers: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9]+$/i).max(40).optional().describe('Absent : nouveau fournisseur.'),
        name: z.string().trim().max(60).default(''),
        baseUrl: z.url({ protocol: /^https?$/ }).max(500).describe('URL de base compatible OpenAI v1, ex. `https://api.openai.com/v1`.'),
        timeoutSeconds: z.number().int().min(5).max(AI_LIMITS.timeoutMax).default(AI_LIMITS.timeoutSeconds).describe('Délai maximal d’une réponse, en secondes.'),
        models: aiModelsSchema,
        apiKey: z.string().max(500).optional().describe('Absent : garder la clé actuelle ; chaîne vide : l’effacer.'),
        verifyCertificate: z.boolean().default(true).describe('`false` : accepter un certificat HTTPS non reconnu (auto-signé).'),
      }),
    )
    .min(1, 'Ajoutez au moins un fournisseur.')
    .max(AI_LIMITS.providers)
    .refine((providers) => providers.some((provider) => provider.models.length > 0), 'Choisissez au moins un modèle.'),
  defaultModel: z.string().trim().min(1).max(300).describe('Référence `fournisseur:modèle` (`new0:…` pour le premier fournisseur ajouté).'),
  maxSteps: z.number().int().min(1).max(AI_LIMITS.stepsMax).default(AI_LIMITS.steps).describe('Tours de réflexion : appels d’outils maximum par question.'),
  maxTurns: z.number().int().min(1).max(AI_LIMITS.turnsMax).default(AI_LIMITS.turns).describe('Tours de discussion : échanges précédents transmis au modèle.'),
});

/** Essai ou détection des modèles avec les valeurs du formulaire (pas encore enregistrées). */
export const aiProbeSchema = z.object({
  providerId: z.string().max(40).optional().describe('Fournisseur enregistré dont la clé sert si aucune n’est saisie.'),
  baseUrl: z.url({ protocol: /^https?$/ }).max(500),
  timeoutSeconds: z.number().int().min(5).max(AI_LIMITS.timeoutMax).optional(),
  model: z.string().trim().max(200).optional(),
  apiKey: z.string().max(500).optional().describe('Absent ou vide : clé enregistrée.'),
  verifyCertificate: z.boolean().default(true).describe('`false` : accepter un certificat HTTPS non reconnu (auto-signé).'),
});

// --- RAG (recherche sémantique) ---------------------------------------------------------------------------------------

const ragEndpointFields = {
  baseUrl: z.url({ protocol: /^https?$/ }).max(500).describe('URL de base compatible OpenAI v1 (`POST {baseUrl}/embeddings`), ex. `http://localhost:11434/v1` pour Ollama.'),
  model: z.string().trim().max(200).describe('Modèle d’embeddings, ex. `embeddinggemma`, `nomic-embed-text`, `qwen3-embedding:0.6b`.'),
  format: z
    .enum(RAG_FORMATS)
    .default('auto')
    .describe('Mise en forme des textes : `auto` (d’après le nom du modèle), `none`, `embeddinggemma`, `nomic`, `qwen3`, ou `custom` (gabarits).'),
  queryTemplate: z.string().max(RAG_LIMITS.templateMax).default('').describe('Gabarit d’une question (`custom`) : `{text}`.'),
  documentTemplate: z.string().max(RAG_LIMITS.templateMax).default('').describe('Gabarit d’un passage indexé (`custom`) : `{text}`, `{title}`.'),
  dimensions: z.number().int().min(8).max(RAG_LIMITS.dimensionsMax).nullable().default(null).describe('Taille des vecteurs gardés (tronqués : modèles « Matryoshka ») ; `null` : celle du modèle.'),
  timeoutSeconds: z.number().int().min(5).max(RAG_LIMITS.timeoutMax).default(RAG_LIMITS.timeoutSeconds),
  apiKey: z.string().max(500).optional().describe('Absent : garder la clé actuelle (ou, pour un essai, la clé enregistrée) ; chaîne vide : l’effacer.'),
  verifyCertificate: z.boolean().default(true).describe('`false` : accepter un certificat HTTPS non reconnu (auto-signé).'),
};

export const ragSettingsSchema = z.object({
  enabled: z.boolean(),
  ...ragEndpointFields,
  intervalHours: z
    .number()
    .int()
    .min(RAG_LIMITS.intervalHoursMin)
    .max(RAG_LIMITS.intervalHoursMax)
    .default(RAG_LIMITS.intervalHoursDefault)
    .describe('Réindexation automatique, en heures (24 : chaque jour).'),
  chunkChars: z.number().int().min(RAG_LIMITS.chunkCharsMin).max(RAG_LIMITS.chunkCharsMax).default(RAG_LIMITS.chunkChars).describe('Taille visée d’un passage, en caractères.'),
});
export const ragProbeSchema = z.object(ragEndpointFields);
export const ragReindexSchema = z.object({ rebuild: z.boolean().default(false).describe('Tout recalculer, au lieu de ce qui a changé.') });

export const aiConversationSchema = z.object({
  title: z.string().trim().min(1).max(120),
  context: aiContextSchema,
  turns: z.array(z.unknown()).max(AI_LIMITS.messages * 2).describe('Tours affichés dans le panneau (format de l’interface).'),
});

const ldapFields = {
  profile: z.enum(LDAP_PROFILES).default('classic').describe('`classic` : nom lu tel quel ; `specific` : compte de service obligatoire, nom écrit « NOM, Prénom (Société) ».'),
  host: z.string().trim().max(255).regex(/^[A-Za-z0-9._:-]*$/, 'Nom d’hôte ou adresse IP invalide.'),
  port: z.number().int().min(1).max(65_535),
  security: z.enum(LDAP_SECURITY).default('none').describe('`none` : en clair ; `ldaps` : TLS dès la connexion ; `starttls` : passage en TLS après la connexion.'),
  verifyCertificate: z.boolean().default(true),
  caPath: z.string().trim().max(LDAP_LIMITS.textMax).default('').describe('Autorité de certification interne (PEM). Chemin absolu, ou relatif au dossier de FastBoard.'),
  timeoutSeconds: z.number().int().min(LDAP_LIMITS.timeoutMin).max(LDAP_LIMITS.timeoutMax).default(30),
  bindDn: z.string().trim().max(LDAP_LIMITS.textMax).default('').describe('Compte de service qui cherche la personne (vide : recherche anonyme).'),
  bindPassword: z.string().max(LDAP_LIMITS.textMax).optional().describe('Absent : garder le mot de passe enregistré ; chaîne vide : l’effacer.'),
  searchBase: z.string().trim().max(LDAP_LIMITS.textMax),
  userFilter: z.string().trim().max(LDAP_LIMITS.filterMax).refine((value) => value.includes(LDAP_USER_TOKEN), 'Le filtre doit contenir {user}.').describe('Filtre LDAP ; `{user}` est remplacé par l’identifiant saisi.'),
  emailAttribute: z.string().trim().min(1).max(LDAP_LIMITS.attributeMax),
  nameAttribute: z.string().trim().min(1).max(LDAP_LIMITS.attributeMax),
};

export const ldapSettingsSchema = z
  .object({
    enabled: z.boolean(),
    ...ldapFields,
    loginLabel: z.string().trim().max(LDAP_LIMITS.labelMax).default('').describe('Libellé du champ d’identifiant sur la page de connexion.'),
    defaultRoleId: id.nullable().default(null).describe('Rôle global des comptes créés à la première connexion (`null` : Membre).'),
    linkExisting: z.boolean().default(true).describe('Rattache à l’annuaire un compte local de même adresse e-mail (jamais un super administrateur).'),
  })
  .superRefine((value, issue) => {
    if (!value.enabled) return;
    if (!value.host) issue.addIssue({ code: 'custom', path: ['host'], message: 'Indiquez le serveur de l’annuaire.' });
    if (!value.searchBase) issue.addIssue({ code: 'custom', path: ['searchBase'], message: 'Indiquez la base de recherche.' });
    if (value.profile === 'specific' && !value.bindDn) issue.addIssue({ code: 'custom', path: ['bindDn'], message: 'Le profil spécifique demande un compte de service.' });
  });

/** Essai avec les valeurs du formulaire (pas encore enregistrées), éventuellement sur un compte. */
export const ldapTestSchema = z.object({
  ...ldapFields,
  host: ldapFields.host.min(1, 'Indiquez le serveur de l’annuaire.'),
  login: z.string().trim().max(200).default('').describe('Identifiant à chercher (facultatif).'),
  password: z.string().max(200).default('').describe('Mot de passe de ce compte (facultatif, jamais enregistré).'),
});

/** Dossier des images collées dans une note, relatif à elle (`Pictures`, `Captures/2026`) : nettoyé, sans remontée ni dossier caché. */
const imageFolderName = z
  .string()
  .max(DOC_LIMITS.imageFolderMax)
  .refine((value) => normalizeImageFolder(value) !== null, 'Nom de dossier invalide.')
  .transform((value) => normalizeImageFolder(value)!);

export const docSettingsSchema = z.object({
  enabled: z.boolean().optional().describe('Documentation visible sur le site.'),
  imageFolder: imageFolderName.optional().describe('Sous-dossier, à côté de la note, où vont les images collées ou glissées, pour les espaces qui n’ont pas le leur (`Pictures` par défaut).'),
});

export const docSpaceSchema = z.object({
  name: z.string().trim().min(1, 'Donnez un nom à l’espace.').max(DOC_LIMITS.nameMax),
  description: z.string().trim().max(DOC_LIMITS.descriptionMax).default(''),
  obsidian: z.boolean().optional().describe('Syntaxe propre à Obsidian : callouts, `==surlignage==`, `%%commentaires%%`, `#étiquettes`, notes de bas de page, propriétés… (vrai par défaut).'),
  imageFolder: z
    .union([z.literal('').transform(() => null), z.null(), imageFolderName])
    .optional()
    .describe('Sous-dossier, à côté de la note, où vont les images collées ou glissées dans cet espace ; `null` ou vide : celui réglé dans l’administration.'),
});
export const docSpaceUpdateSchema = docSpaceSchema.partial().extend({
  rag: z.boolean().optional().describe('Recherche sémantique (RAG) : indexer ses notes pour l’assistant IA (désactivé par défaut ; l’administrateur règle le modèle dans Administration → IA).'),
});

export const docMemberRoleSchema = z.object({ role: z.enum(DOC_ROLES).describe('`reader` : lecture ; `editor` : écriture ; `owner` : membres et réglages.') });
export const docMemberSchema = docMemberRoleSchema.extend({ userId: id });

export const docNodeSchema = z.object({
  path: z.string().min(1).max(1000).describe('Chemin relatif à l’espace, ex. `Guides/Installation` ; l’extension `.md` est ajoutée aux notes et les dossiers manquants sont créés.'),
  kind: z.enum(['folder', 'markdown', 'template']).default('markdown').describe('`template` : modèle de note de l’espace (un nom sans dossier, à part des notes).'),
  content: z.string().max(DOC_LIMITS.fileChars).optional().describe('Texte initial d’une note.'),
  fromId: id.optional().describe('Note ou modèle de l’espace dont partir, à la place de `content` : une note créée d’après un modèle reçoit son texte, `{{title}}`, `{{date}}`, `{{time}}` et `{{author}}` remplis ; sinon le texte est copié tel quel.'),
});
export const docMoveSchema = z.object({ path: z.string().min(1).max(1000).describe('Nouveau chemin (renommage ou déplacement).') });
export const docContentSchema = z.object({ content: z.string().max(DOC_LIMITS.fileChars) });
export const docMemoSchema = z.object({ memo: z.string().max(DOC_LIMITS.memoMax).describe('À quoi sert ce fichier ou ce dossier (vide pour effacer).') });
export const docFolderStyleSchema = z.object({
  icon: z.enum(DOC_FOLDER_ICONS).nullable().optional().describe('Icône du dossier (PrimeIcons) ; `null` : le dossier habituel ; absente : inchangée.'),
  color: color.nullable().optional().describe('Couleur de l’icône, `#RRGGBB` ; `null` : celle par défaut ; absente : inchangée.'),
});
export const docSiteSchema = z.object({
  visibility: z.enum(DOC_SITE_VISIBILITIES).describe('`members` : membres de l’espace ; `people` : personnes choisies et propriétaires ; `public` : tout le monde, sans compte.'),
  people: z.array(id).max(200).default([]).describe('Personnes qui peuvent lire le site (`people`).'),
});
// --- Étiquettes de versions (notes et tableaux) ------------------------------------------------------------------------

const tagName = z.string().trim().min(1, 'Donnez un nom à l’étiquette.').max(VERSION_TAG_LIMITS.nameMax).describe('Nom de l’étiquette (« v1.0 », « Validé client »…), unique pour cet élément.');
export const versionTagSchema = z.object({
  name: tagName,
  versionId: id.optional().describe('Version à étiqueter ; absente : l’état actuel (une version est créée au besoin).'),
});
export const versionTagUpdateSchema = z.object({ name: tagName.nullable().describe('Nouveau nom ; `null` retire l’étiquette (la version suit alors la durée de conservation de l’historique).') });
export const tagSearchSchema = z.object({ q: z.string().trim().max(100).default('').describe('Mots à trouver dans le nom de l’étiquette ou celui de l’élément.') });

export const docRestoreSchema = z.object({ content: z.string().max(DOC_LIMITS.fileChars).optional().describe('Texte final, si l’on ne reprend qu’une partie de la version ; absent : la version entière.') });
export const docImportCompareSchema = z.object({ path: z.string().min(1).max(1000).describe('Chemin du fichier, tel que renvoyé par l’analyse.') });
export const docCommentSchema = z.object({
  body: z.string().trim().min(1).max(DOC_COMMENT_LIMITS.body).describe('Texte du commentaire ; `@[Nom](user:12)` mentionne une personne.'),
  quote: z.string().max(DOC_COMMENT_LIMITS.quote).default('').describe('Passage commenté, sans sa syntaxe Markdown (vide pour une réponse).'),
  before: z.string().max(DOC_COMMENT_LIMITS.context).default('').describe('Texte juste avant le passage.'),
  after: z.string().max(DOC_COMMENT_LIMITS.context).default('').describe('Texte juste après le passage.'),
  parentId: id.optional().describe('Commentaire auquel celui-ci répond.'),
});
export const docCommentResolveSchema = z.object({ resolved: z.boolean() });
export const docSearchSchema = z.object({ q: z.string().trim().max(100).default('') });

// --- Tableaux blancs ---------------------------------------------------------------------------------------------------

export const boardSettingsSchema = z.object({ enabled: z.boolean() });
export const boardSpaceSchema = z.object({
  name: z.string().trim().min(1, 'Donnez un nom à l’espace.').max(BOARD_LIMITS.nameMax),
  description: z.string().trim().max(BOARD_LIMITS.descriptionMax).default(''),
});
export const boardSpaceUpdateSchema = boardSpaceSchema.partial().extend({
  rag: z.boolean().optional().describe('Recherche sémantique (RAG) : indexer ses tableaux blancs pour l’assistant IA (désactivé par défaut ; l’administrateur règle le modèle dans Administration → IA).'),
});
export const boardMemberRoleSchema = docMemberRoleSchema;
export const boardMemberSchema = docMemberSchema;
const boardElements = z
  .array(z.record(z.string(), z.unknown()))
  .max(BOARD_LIMITS.elements)
  .describe('Éléments du tableau (voir le guide de l’API) ; un élément illisible est ignoré.');
export const boardNodeSchema = z.object({
  path: z.string().min(1).max(BOARD_LIMITS.pathMax).describe('Chemin dans l’espace, ex. `Ateliers/Rétro de mars` ; les dossiers manquants sont créés.'),
  kind: z.enum(['folder', 'board', 'template']).default('board').describe('`template` : modèle de l’espace (un nom sans dossier), inséré dans les tableaux.'),
  elements: boardElements.optional().describe('Éléments de départ d’un tableau ou d’un modèle.'),
});
export const boardIconSchema = z.object({
  name: z.string().trim().min(1).max(BOARD_ICON_LIMITS.nameMax),
  svg: z.string().min(1).max(BOARD_ICON_LIMITS.svgBytes).describe('Texte du SVG (sans script ni contenu externe).'),
});
export const boardMoveSchema = z.object({ path: z.string().min(1).max(BOARD_LIMITS.pathMax).describe('Nouveau chemin (renommage ou déplacement).') });
export const boardElementsSchema = z.object({ elements: boardElements });
export const boardForkSchema = z.object({ name: z.string().trim().min(1).max(BOARD_LIMITS.nameMax).optional().describe('Nom du nouveau tableau ; absent : celui du tableau, suivi de « (version) ».') });
export const boardElementsPatchSchema = z.object({
  upsert: boardElements.default([]).describe('Éléments ajoutés, ou remplacés s’ils ont le même `id`.'),
  remove: z.array(z.string().min(1).max(40)).max(BOARD_LIMITS.elements).default([]).describe('Identifiants des éléments à retirer (les liens accrochés partent avec eux).'),
});
export const boardShareSchema = z.object({
  audience: z.enum(BOARD_SHARE_AUDIENCES).describe('`users` : toute personne connectée ; `people` : les personnes de `people` ; `public` : tout le monde, même sans compte.'),
  people: z.array(id).max(BOARD_SHARE_LIMITS.people).default([]),
  role: z.enum(BOARD_SHARE_ROLES).default('reader').describe('`reader` : voir en direct ; `editor` : modifier.'),
  password: z.string().max(BOARD_SHARE_LIMITS.passwordMax).nullable().optional().describe('Absent : inchangé ; `null` ou vide : retiré.'),
});
export const boardUnlockSchema = z.object({ password: z.string().min(1).max(BOARD_SHARE_LIMITS.passwordMax) });
export const boardSearchSchema = z.object({ q: z.string().trim().max(100).default(''), limit: z.coerce.number().int().min(1).max(50).default(10) });
export const docImportApplySchema = z.object({
  decisions: z
    .array(
      z.object({
        path: z.string().min(1).max(1000),
        action: z.enum(['auto', 'keep', 'incoming', 'both', 'delete']).describe('`auto` : résultat proposé ; `keep` : garder le serveur ; `incoming` : prendre l’import ; `both` : garder les deux ; `delete` : supprimer du serveur.'),
        content: z.string().max(DOC_LIMITS.fileChars).optional().describe('Texte final, choisi dans le comparateur (avec `auto`).'),
      }),
    )
    .max(DOC_LIMITS.zipFiles),
});

const certificateFiles = {
  format: z.enum(['pem', 'pfx']).default('pem').describe('`pem` : certificat + clé privée ; `pfx` : fichier PKCS#12.'),
  certPath: z.string().trim().max(1000).default('').describe('Certificat PEM (chaîne complète conseillée). Chemin absolu, ou relatif au dossier de FastBoard.'),
  keyPath: z.string().trim().max(1000).default('').describe('Clé privée PEM.'),
  caPath: z.string().trim().max(1000).default('').describe('Certificats intermédiaires PEM (facultatif).'),
  pfxPath: z.string().trim().max(1000).default('').describe('Fichier .pfx / .p12.'),
  passphrase: z.string().max(500).optional().describe('Mot de passe de la clé ou du PFX. Absent : garder celui enregistré ; chaîne vide : l’effacer.'),
};

export const httpsSettingsSchema = z
  .object({
    enabled: z.boolean().describe('Servir aussi le site en HTTPS.'),
    port: z.number().int().min(1).max(65_535).describe('Port HTTPS (443 en production).'),
    ...certificateFiles,
    redirectHttp: z.boolean().default(false).describe('Rediriger les visites HTTP vers HTTPS (sauf depuis la machine elle-même).'),
    hsts: z.boolean().default(false).describe('En-tête Strict-Transport-Security.'),
    hstsMaxAgeDays: z.number().int().min(1).max(730).default(180),
    trustProxy: z.boolean().default(false).describe('Derrière un proxy inverse qui termine le TLS : faire confiance à X-Forwarded-*.'),
  })
  .refine((value) => !value.enabled || (value.format === 'pfx' ? value.pfxPath : value.certPath && value.keyPath), 'Indiquez les fichiers du certificat pour activer HTTPS.');

export const httpsTestSchema = z.object(certificateFiles);

export const selfSignedSchema = z.object({
  hostnames: z.array(z.string().trim().min(1).max(253).regex(/^[A-Za-z0-9.:*-]+$/, 'Nom d’hôte ou adresse IP invalide.')).min(1).max(20).describe('Noms et adresses couverts (ex. `fastboard.local`, `192.168.1.20`).'),
});

export const activityCommentSchema = z.object({
  body: z.string().trim().min(1, 'Le commentaire est vide.').max(2_000).describe('Texte ; mentions : `@[Nom](user:ID)` (la personne est notifiée).'),
});

export const notificationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  before: z.coerce.number().int().positive().optional().describe('Curseur : notifications plus anciennes que cet identifiant.'),
  unread: z.enum(['true', 'false']).transform((value) => value === 'true').optional().describe('`true` : seulement les non lues.'),
});
export const markReadSchema = z.object({
  ids: z.array(id).max(500).optional().describe('Notifications à marquer comme lues ; absent = toutes.'),
});
export const notificationSettingSchema = z.object({
  level: z
    .enum(NOTIFICATION_LEVELS)
    .describe('`all` : toute l’activité des tickets du projet ; `participating` (par défaut) : tickets suivis, assignations et mentions ; `mentions` : seulement les mentions ; `none` : aucune notification, mentions comprises.'),
});

export const appNameSchema = z.object({ name: z.string().trim().min(1).max(40).describe("Nom affiché de l'application.") });

const appIconData = z.string().max(1_500_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, 'Icône invalide (PNG en base64).');
/** Icônes de l'application installée (PWA) tirées du logo, dessinées par le navigateur de l'administrateur. */
export const appIconsSchema = z.object({
  icons: z
    .object({
      'icon-192': appIconData.describe('192 × 192, logo sur fond transparent.'),
      'icon-512': appIconData.describe('512 × 512, logo sur fond transparent.'),
      'maskable-192': appIconData.describe('192 × 192, fond plein, logo dans la zone sûre (80 % au centre).'),
      'maskable-512': appIconData.describe('512 × 512, fond plein, logo dans la zone sûre.'),
      'apple-touch-icon': appIconData.describe('180 × 180, fond plein (iPhone, iPad).'),
    })
    .strict(),
});
export const maintenanceSchema = z.object({
  enabled: z.boolean(),
  level: z.enum(['info', 'warning', 'danger']).describe('`info` : information ; `warning` : perturbations ; `danger` : interruption.'),
  title: z.string().trim().max(120).default(''),
  message: z.string().trim().max(2000).default(''),
  startsAt: z.iso.datetime({ offset: true }).nullable().default(null).describe('Début annoncé (ISO 8601) ; `null` = maintenant.'),
  endsAt: z.iso.datetime({ offset: true }).nullable().default(null).describe('Fin : le message disparaît tout seul ; `null` = jusqu’à désactivation.'),
});

export const exportQuerySchema = z.object({
  format: z.enum(['json', 'csv']).default('json').describe('`json` : export complet (configuration, tickets, commentaires, historique) ; `csv` : tableau des tickets.'),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1, 'Saisissez un texte à rechercher.').max(200).describe('Texte recherché (accents et casse ignorés), ou une clé de ticket « APP-12 ».'),
  type: csv(['projects', 'tickets', 'users', 'docs'] as const).optional().describe('Types de résultats, séparés par des virgules (tous par défaut).'),
  limit: z.coerce.number().int().min(1).max(100).default(8).describe('Nombre de résultats par type.'),
});

export const attachmentLinkSchema = z.object({
  kind: z.enum(['url', 'path']).describe('`url` : lien web ; `path` : chemin vers un fichier ou un dossier (poste ou partage réseau).'),
  target: z.string().trim().min(1).max(LIMITS.linkTargetMax).describe('Adresse (https://…) ou chemin absolu (C:\\…, \\\\serveur\\…, /…).').meta({ example: 'https://exemple.fr/specification' }),
  name: z.string().trim().max(LIMITS.attachmentNameMax).optional().describe('Nom affiché (par défaut : déduit de la cible).'),
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
