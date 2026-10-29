/**
 * Tous les schémas de validation des requêtes. Ils servent à la fois à valider les routes et à générer
 * la documentation OpenAPI (`server/openapi`) : une seule source de vérité.
 */
import { AI_LIMITS, REASONING_LEVELS } from '../../shared/ai.ts';
import { parseRetentionRules } from '../../shared/backup.ts';
import { LIMITS, TICKET_STATUSES } from '../../shared/constants.ts';
import { isISODate } from '../../shared/dates.ts';
import { COLUMN_LABEL_MAX, SORT_FIELDS } from '../../shared/settings.ts';
import { LOCALES } from '../../shared/locales.ts';
import { LOG_LEVELS } from '../../shared/monitoring.ts';
import { CUSTOM_FIELD_LIMITS, CUSTOM_FIELD_TYPES, TICKET_FIELDS } from '../../shared/ticketFields.ts';
import { APPEARANCE_LIMITS, SURFACE_PALETTES, THEME_PRESETS, isFontFamily, isThemeId } from '../../shared/themes.ts';
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
          }),
        )
        .max(APPEARANCE_LIMITS.themes),
      fonts: z.object({
        body: z.string().max(APPEARANCE_LIMITS.fontMax).refine(isFontFamily, 'Police invalide.'),
        heading: z.string().max(APPEARANCE_LIMITS.fontMax).refine(isFontFamily, 'Police invalide.'),
        mono: z.string().max(APPEARANCE_LIMITS.fontMax).refine(isFontFamily, 'Police invalide.'),
        size: z.number().int().min(APPEARANCE_LIMITS.sizeMin).max(APPEARANCE_LIMITS.sizeMax),
      }),
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
  parentId: nullableId.optional().describe('Ticket parent : fait de ce ticket un sous-ticket (même projet, un seul niveau). `null` pour le détacher.'),
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
      }),
    )
    .min(1)
    .max(AI_LIMITS.messages)
    .refine((messages) => messages.at(-1)?.role === 'user', 'Le dernier message doit venir de la personne.'),
  context: z.object({ projectId: id.nullable().optional(), ticketId: id.nullable().optional() }).default({}),
  allowWrite: z.boolean().default(false).describe("Autorise l'assistant à modifier (si la personne en a le droit)."),
  writeMode: z.enum(['apply', 'propose']).default('apply').describe('`apply` : modifications faites directement ; `propose` : proposées, à valider par la personne.'),
  model: z.string().max(300).optional().describe('Référence d’un modèle mis à disposition (`GET /ai/models` → `ref`) ; absent = modèle par défaut.'),
  reasoning: z.enum(REASONING_LEVELS).optional().describe('Niveau de réflexion, pour les modèles qui le gèrent.'),
});

const aiModelsSchema = z
  .array(
    z.object({
      id: z.string().trim().min(1).max(200),
      label: z.string().trim().max(80).default(''),
      vision: z.boolean().default(false),
      contextWindow: z.number().int().min(1_000).max(10_000_000).default(128_000).describe('Taille du contexte en jetons.'),
      reasoning: z.boolean().default(false).describe('Le modèle accepte un niveau de réflexion (reasoning_effort).'),
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
});

export const aiConversationSchema = z.object({
  title: z.string().trim().min(1).max(120),
  context: z.object({ projectId: id.nullable().optional(), ticketId: id.nullable().optional() }).default({}),
  turns: z.array(z.unknown()).max(AI_LIMITS.messages * 2).describe('Tours affichés dans le panneau (format de l’interface).'),
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

export const appNameSchema = z.object({ name: z.string().trim().min(1).max(40).describe("Nom affiché de l'application.") });
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
  type: csv(['projects', 'tickets', 'users'] as const).optional().describe('Types de résultats, séparés par des virgules (tous par défaut).'),
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
