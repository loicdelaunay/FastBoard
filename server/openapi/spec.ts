/**
 * Description OpenAPI 3.1 de l'API FastBoard.
 * Les corps de requête et les paramètres d'URL sont générés depuis les schémas de validation réels (`http/schemas.ts`) :
 * la documentation ne peut pas diverger des routes. Le test `openapi.test.ts` vérifie en plus que chaque route est décrite.
 */
import { LINK_REASONS, TICKET_STATUSES } from '../../shared/constants.ts';
import { APP_VERSION } from '../../shared/changelog.ts';
import { z } from '../http/validate.ts';
import * as S from '../http/schemas.ts';
import { arr, bool, componentSchemas, dateTime, int, nullable, obj, ref, str, type Schema } from './components.ts';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

interface Operation {
  method: Method;
  path: string;
  tag: string;
  summary: string;
  description?: string;
  /** `public` : sans authentification ; `any` : jeton d'API ou session ; `session` : interface uniquement. */
  access?: 'public' | 'any' | 'session';
  /** Permission requise (documentaire ; le serveur est la référence). */
  permission?: string;
  /** Description des paramètres de chemin. */
  params?: Record<string, string>;
  /** Paramètres de chemin textuels (entiers par défaut). */
  stringParams?: string[];
  body?: z.ZodType;
  rawBody?: { contentType: string; description: string };
  query?: z.ZodType;
  /** Paramètres supplémentaires (en-têtes…), déjà au format OpenAPI. */
  extraParams?: Schema[];
  /** Schéma de la réponse en cas de succès. */
  ok?: Schema;
  status?: number;
  /** Réponse non JSON. */
  okRaw?: { contentType: string; description: string };
}

const MAX_SAFE = 9007199254740991;

/** JSON Schema d'un schéma zod (entrée), nettoyé des détails inutiles à la lecture. */
function jsonSchema(schema: z.ZodType): Schema {
  const result = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any', target: 'draft-2020-12' }) as Schema;
  delete result.$schema;
  const clean = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(clean);
    } else if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>;
      if (record.maximum === MAX_SAFE) delete record.maximum;
      Object.values(record).forEach(clean);
    }
  };
  clean(result);
  return result;
}

function queryParameters(schema: z.ZodType): Schema[] {
  const json = jsonSchema(schema) as { properties?: Record<string, Schema>; required?: string[] };
  return Object.entries(json.properties ?? {}).map(([name, property]) => {
    const { description, ...rest } = property as { description?: string } & Schema;
    return { name, in: 'query', required: json.required?.includes(name) ?? false, ...(description ? { description } : {}), schema: rest };
  });
}

const ok = (schema: Schema, description = 'Succès.'): Schema => ({ description, content: { 'application/json': { schema } } });
const errorResponse = (description: string): Schema => ({ description, content: { 'application/json': { schema: ref('Error') } } });

const ID = { id: 'Identifiant numérique.' };
const PROJECT_ID = { id: 'Identifiant du projet.' };
const DOC_SPACE_ID = { id: 'Identifiant de l’espace.' };
const DOC_NODE_ID = { id: 'Identifiant du fichier ou du dossier.' };
const BOARD_SPACE_ID = { id: 'Identifiant de l’espace de tableaux.' };
const BOARD_NODE_ID = { id: 'Identifiant du tableau ou du dossier.' };
const BOARD_ID = { id: 'Identifiant du tableau.' };
/** Thème de la bibliothèque du site. */
const SHARED_THEME = obj({ id: str(), theme: { type: 'object', description: 'label, mode, preset, primary, surface, colors, fonts' }, authorId: nullable(int()), authorName: str(), createdAt: str() });
const TICKET_ID = { id: 'Identifiant du ticket (champ `id`, pas la clé `APP-12`).' };

const OPERATIONS: Operation[] = [
  // --- Documentation ---------------------------------------------------------------------------------------------------
  { method: 'get', path: '/health', tag: 'Documentation', access: 'public', summary: 'État du serveur', ok: obj({ status: str() }) },
  {
    method: 'get',
    path: '/openapi.json',
    tag: 'Documentation',
    access: 'public',
    summary: 'Description OpenAPI de cette API',
    description: 'Ce document. Importable dans Postman, Insomnia ou n\'importe quel client OpenAPI.',
    okRaw: { contentType: 'application/json', description: 'Document OpenAPI 3.1.' },
  },
  {
    method: 'get',
    path: '/docs/guide.md',
    tag: 'Documentation',
    access: 'public',
    summary: 'Guide d\'utilisation pour une IA ou un script (Markdown)',
    description: "Concepts, recettes pas à pas et bonnes pratiques. À lire en premier pour faire travailler un agent sur le tableau.",
    okRaw: { contentType: 'text/markdown', description: 'Guide au format Markdown.' },
  },

  {
    method: 'get',
    path: '/app',
    tag: 'Documentation',
    access: 'public',
    summary: "Nom, logo, version et message de maintenance de l'application",
    ok: ref('AppInfo'),
  },
  { method: 'get', path: '/app/logo', tag: 'Documentation', access: 'public', summary: "Logo de l'application", okRaw: { contentType: 'image/*', description: 'Image (404 si le logo par défaut est utilisé).' } },

  // --- Authentification ------------------------------------------------------------------------------------------------
  {
    method: 'post',
    path: '/auth/login',
    tag: 'Authentification',
    access: 'public',
    summary: 'Ouvrir une session (cookie)',
    description: "Réservé à l'interface. **Pour un script ou une IA, utilisez plutôt un jeton d'API** (`Authorization: Bearer fb_…`).",
    body: S.loginSchema,
    ok: obj({ user: ref('Me') }),
  },
  { method: 'post', path: '/auth/logout', tag: 'Authentification', access: 'public', summary: 'Fermer la session', ok: ref('Ok') },
  {
    method: 'get',
    path: '/me',
    tag: 'Authentification',
    summary: 'Qui suis-je ? (compte, permissions, jeton utilisé)',
    description: "Premier appel recommandé pour un agent : vérifie que le jeton fonctionne et indique ses limites (`token.scope`, `token.projectIds`).",
    ok: obj({ user: ref('Me'), token: { oneOf: [ref('TokenInfo'), { type: 'null' }] } }),
  },

  // --- Jetons d'API ----------------------------------------------------------------------------------------------------
  {
    method: 'get',
    path: '/me/tokens',
    tag: "Jetons d'API",
    access: 'session',
    summary: 'Lister mes jetons',
    ok: obj({ tokens: arr(ref('ApiToken')) }),
  },
  {
    method: 'post',
    path: '/me/tokens',
    tag: "Jetons d'API",
    access: 'session',
    permission: 'tokens.create',
    summary: 'Créer un jeton',
    description:
      "Le secret (`secret`, commence par `fb_`) n'est **affiché qu'une seule fois** : copiez-le immédiatement. Le jeton agit avec vos droits, limités par sa portée (`read`/`write`) et, si renseignée, sa liste de projets.",
    body: S.createTokenSchema,
    status: 201,
    ok: obj({ token: ref('ApiToken'), secret: str("Secret en clair, à transmettre à l'agent. Non récupérable ensuite.") }),
  },
  {
    method: 'patch',
    path: '/me/tokens/{id}',
    tag: "Jetons d'API",
    access: 'session',
    summary: "Renommer (nom d'affichage) ou prolonger un de mes jetons",
    description: "`expiresInDays` repart d'aujourd'hui (un jeton expiré peut ainsi être prolongé) ; `null` = n'expire plus. Un jeton révoqué ne peut plus être modifié.",
    params: { id: 'Identifiant du jeton.' },
    body: S.updateTokenSchema,
    ok: obj({ token: ref('ApiToken') }),
  },
  {
    method: 'post',
    path: '/me/tokens/{id}/reveal',
    tag: "Jetons d'API",
    access: 'session',
    summary: 'Réafficher le secret d\'un de mes jetons',
    description: "Exige le mot de passe du compte. Possible pour les jetons créés depuis la version 1.1 (`revealable`), dont le secret est conservé chiffré.",
    params: { id: 'Identifiant du jeton.' },
    body: S.revealTokenSchema,
    ok: obj({ secret: str('Secret du jeton (`fb_…`).') }),
  },
  {
    method: 'delete',
    path: '/me/tokens/{id}',
    tag: "Jetons d'API",
    access: 'session',
    summary: 'Révoquer un de mes jetons',
    params: { id: 'Identifiant du jeton.' },
    ok: ref('Ok'),
  },

  // --- Assistant IA ------------------------------------------------------------------------------------------------------
  {
    method: 'post',
    path: '/ai/chat',
    tag: 'Assistant IA',
    access: 'session',
    permission: 'ai.use (et ai.read / ai.write dans le projet)',
    summary: "Poser une question à l'assistant IA (réponse en flux)",
    description: "Réponse `text/event-stream` : évènements `model`, `step` (outil utilisé), `thought` (raisonnement exposé par le modèle), `change` (modification faite ou proposée, avec ses différences et de quoi l'annuler), `message` (réponse Markdown), `error`, `done` ({changes}). L'assistant lit avec les droits de la personne ; il ne modifie que si `allowWrite` est vrai et que la personne a `ai.write` plus la permission concernée. Avec `writeMode: propose`, il ne fait que proposer : l'interface applique ensuite les propositions validées avec l'API habituelle.",
    body: S.aiChatSchema,
    okRaw: { contentType: 'text/event-stream', description: 'Flux d’évènements JSON (une ligne « data: … » par évènement).' },
  },

  {
    method: 'get',
    path: '/ai/models',
    tag: 'Assistant IA',
    access: 'session',
    permission: 'ai.use',
    summary: 'Modèles proposés dans le panneau de l’assistant',
    ok: obj({ models: arr({ type: 'object', description: 'ref (à passer dans `model`), id, label, provider, vision, contextWindow, reasoning' }), defaultModel: str('Référence du modèle par défaut.') }),
  },
  { method: 'get', path: '/ai/conversations', tag: 'Assistant IA', access: 'session', permission: 'ai.use', summary: 'Mes 50 dernières conversations avec l’assistant', ok: obj({ conversations: arr({ type: 'object', description: 'id, title, messageCount, createdAt, updatedAt' }) }) },
  { method: 'get', path: '/ai/conversations/{id}', tag: 'Assistant IA', access: 'session', permission: 'ai.use', summary: 'Rouvrir une conversation', params: { id: 'Identifiant de la conversation.' }, stringParams: ['id'], ok: obj({ conversation: { type: 'object', description: 'id, title, context, turns, messageCount, createdAt, updatedAt' } }) },
  {
    method: 'put',
    path: '/ai/conversations/{id}',
    tag: 'Assistant IA',
    access: 'session',
    permission: 'ai.use',
    summary: 'Enregistrer une conversation',
    description: 'Crée ou remplace la conversation (identifiant choisi par l’interface) ; seules les 50 plus récentes de chaque personne sont gardées.',
    params: { id: 'Identifiant de la conversation (8 à 64 lettres, chiffres ou tirets).' },
    stringParams: ['id'],
    body: S.aiConversationSchema,
    ok: obj({ conversation: { type: 'object' } }),
  },
  { method: 'delete', path: '/ai/conversations/{id}', tag: 'Assistant IA', access: 'session', permission: 'ai.use', summary: 'Supprimer une conversation', params: { id: 'Identifiant de la conversation.' }, stringParams: ['id'], ok: obj({ ok: bool() }) },

  // --- Notifications ----------------------------------------------------------------------------------------------------
  {
    method: 'get',
    path: '/me/notifications',
    tag: 'Notifications',
    summary: 'Mes notifications (tickets suivis, assignations, mentions)',
    description: 'Du plus récent au plus ancien, paginé par curseur (`before` / `nextBefore`). `unread` : nombre total de non lues.',
    query: S.notificationQuerySchema,
    ok: obj({ notifications: arr(ref('Notification')), unread: int(), nextBefore: { oneOf: [int(), { type: 'null' }] } }),
  },
  { method: 'post', path: '/me/notifications/read', tag: 'Notifications', summary: 'Marquer des notifications comme lues (toutes si `ids` est absent)', body: S.markReadSchema, ok: obj({ unread: int() }) },
  { method: 'post', path: '/tickets/{id}/watch', tag: 'Notifications', summary: 'Suivre un ticket (être notifié de ses changements)', params: TICKET_ID, ok: obj({ ticket: ref('Ticket') }) },
  { method: 'delete', path: '/tickets/{id}/watch', tag: 'Notifications', summary: 'Ne plus suivre un ticket', params: TICKET_ID, ok: obj({ ticket: ref('Ticket') }) },
  {
    method: 'get',
    path: '/me/notification-settings',
    tag: 'Notifications',
    summary: 'Mes niveaux de notification, projet par projet',
    description:
      'Un réglage par projet visible. `level` : `all` (toute l’activité des tickets du projet), `participating` (par défaut : tickets suivis — créés, assignés, commentés, où l’on est mentionné ou suivis avec « Suivre » —, assignations et mentions), `mentions` (seulement les mentions `@`), `none` (rien, mentions comprises). Les mentions dans la documentation ne dépendent pas d’un projet : elles sont toujours notifiées.',
    ok: obj({ settings: arr(ref('NotificationSetting')), defaultLevel: str('Niveau des projets sans réglage.', { enum: ['participating'] }) }),
  },
  {
    method: 'put',
    path: '/me/notification-settings/{id}',
    tag: 'Notifications',
    summary: 'Choisir mon niveau de notification pour un projet',
    description: 'Il suffit de voir le projet. Diffusé en direct aux autres onglets de la personne (`notifications.settings`).',
    params: PROJECT_ID,
    body: S.notificationSettingSchema,
    ok: obj({ setting: ref('NotificationSetting') }),
  },

  // --- Profil ----------------------------------------------------------------------------------------------------------
  { method: 'patch', path: '/me', tag: 'Profil', access: 'session', summary: 'Modifier mon nom ou mon thème', description: '`appearance` : thèmes personnalisés (couleurs réglées une à une, polices), polices et largeur du texte des notes.', body: S.profileSchema, ok: obj({ user: ref('Me') }) },
  { method: 'get', path: '/themes/shared', tag: 'Profil', summary: 'Thèmes partagés du site', description: 'Thèmes personnalisés publiés par les personnes du site, à ajouter à ses propres thèmes.', ok: obj({ themes: arr(SHARED_THEME) }) },
  { method: 'post', path: '/themes/shared', tag: 'Profil', access: 'session', summary: 'Publier un thème dans la bibliothèque', body: S.sharedThemeSchema, status: 201, ok: obj({ theme: SHARED_THEME }) },
  { method: 'delete', path: '/themes/shared/{id}', tag: 'Profil', access: 'session', permission: 'son auteur, ou `settings.manage`', summary: 'Retirer un thème de la bibliothèque', params: { id: 'Identifiant du thème partagé.' }, stringParams: ['id'], ok: ref('Ok') },
  { method: 'post', path: '/me/password', tag: 'Profil', access: 'session', summary: 'Changer mon mot de passe', body: S.passwordSchema, ok: ref('Ok') },
  {
    method: 'put',
    path: '/me/avatar',
    tag: 'Profil',
    access: 'session',
    summary: 'Définir mon image de profil',
    rawBody: { contentType: 'image/png | image/jpeg | image/webp', description: "Contenu binaire de l'image (512 Ko maximum)." },
    ok: obj({ user: ref('Me') }),
  },
  { method: 'delete', path: '/me/avatar', tag: 'Profil', access: 'session', summary: 'Supprimer mon image de profil', ok: obj({ user: ref('Me') }) },
  { method: 'get', path: '/users', tag: 'Profil', summary: 'Annuaire des utilisateurs actifs', ok: obj({ users: arr(ref('UserSummary')) }) },
  {
    method: 'get',
    path: '/users/{id}/avatar',
    tag: 'Profil',
    summary: "Image de profil d'un utilisateur",
    params: { id: "Identifiant de l'utilisateur." },
    okRaw: { contentType: 'image/*', description: 'Image (404 si aucune).' },
  },
  {
    method: 'get',
    path: '/users/{id}/summary',
    tag: 'Profil',
    summary: "Résumé de l'activité d'un utilisateur",
    description: 'Projets communs, tickets assignés en cours, actions des 30 derniers jours : limité aux projets que vous pouvez voir.',
    params: { id: "Identifiant de l'utilisateur." },
    ok: obj({ summary: ref('UserSummaryPage') }),
  },
  {
    method: 'get',
    path: '/search',
    tag: 'Recherche',
    summary: 'Recherche globale (projets, tickets, utilisateurs)',
    description: 'Accents et casse ignorés ; une clé exacte (`APP-12`) arrive en tête. Chaque type retourne au plus `limit` résultats et son `total`.',
    query: S.searchQuerySchema,
    ok: ref('SearchResult'),
  },
  {
    method: 'get',
    path: '/roles',
    tag: 'Profil',
    summary: 'Rôles disponibles',
    description: 'Par défaut les rôles de projet (pour inviter un membre). `?scope=global` exige une permission d\'administration.',
    ok: obj({ roles: arr(ref('Role')) }),
  },

  // --- Projets ---------------------------------------------------------------------------------------------------------
  { method: 'get', path: '/projects', tag: 'Projets', summary: 'Lister les projets accessibles', ok: obj({ projects: arr(ref('ProjectSummary')) }) },
  {
    method: 'post',
    path: '/projects',
    tag: 'Projets',
    permission: 'projects.create',
    summary: 'Créer un projet',
    description: "Le créateur devient propriétaire ; trois catégories par défaut sont créées. Indisponible avec un jeton limité à certains projets.",
    body: S.createProjectSchema,
    status: 201,
    ok: obj({ project: ref('Project') }),
  },
  {
    method: 'get',
    path: '/projects/{id}',
    tag: 'Projets',
    summary: "Instantané complet d'un projet",
    description:
      "Projet, membres, utilisateurs, catégories, livraisons, **tous les tickets** et vos permissions. Pour un gros projet, préférez `GET /projects/{id}/tickets` avec des filtres.",
    params: PROJECT_ID,
    ok: ref('ProjectSnapshot'),
  },
  {
    method: 'get',
    path: '/projects/{id}/export',
    tag: 'Projets',
    summary: 'Exporter un projet (JSON complet ou CSV des tickets)',
    description: "`format=json` : projet, réglages, membres, listes, livraisons et tickets avec commentaires, pièces jointes (métadonnées) et historique. `format=csv` : une ligne par ticket (séparateur « ; », UTF-8 avec BOM).",
    params: PROJECT_ID,
    query: S.exportQuerySchema,
    okRaw: { contentType: 'application/json | text/csv', description: 'Fichier en téléchargement.' },
  },
  {
    method: 'patch',
    path: '/projects/{id}',
    tag: 'Projets',
    permission: 'project.edit',
    summary: 'Modifier un projet (nom, clé, description, archivage, réglages)',
    description: "`settings` fusionne les automatisations (`autoMoveDone`, `autoReopen`, `confetti`) et, avec `columns`, les six colonnes du Kanban (ordre, noms, couleurs, masquage). Les statuts eux-mêmes sont fixes.",
    params: PROJECT_ID,
    body: S.updateProjectSchema,
    ok: obj({ project: ref('Project') }),
  },
  {
    method: 'delete',
    path: '/projects/{id}',
    tag: 'Projets',
    access: 'session',
    permission: 'project.delete',
    summary: 'Supprimer un projet (irréversible)',
    description: "Réservé à l'interface : un jeton d'API ne peut pas supprimer de projet.",
    params: PROJECT_ID,
    ok: ref('Ok'),
  },
  {
    method: 'get',
    path: '/projects/{id}/tickets',
    tag: 'Tickets',
    summary: 'Lister les tickets (filtres, pagination)',
    description:
      "Triés par numéro. `total` est le nombre de tickets correspondant aux filtres, avant pagination. Exemples : `?status=in_progress,blocked`, `?assigneeId=me`, `?key=APP-12`, `?q=paiement&limit=20`.",
    params: PROJECT_ID,
    query: S.ticketQuerySchema,
    ok: obj({ tickets: arr(ref('Ticket')), total: int() }),
  },
  {
    method: 'post',
    path: '/projects/{id}/tickets',
    tag: 'Tickets',
    permission: 'ticket.create',
    summary: 'Créer un ticket',
    params: PROJECT_ID,
    body: S.createTicketSchema,
    status: 201,
    ok: obj({ ticket: ref('Ticket') }),
  },
  {
    method: 'get',
    path: '/projects/{id}/activity',
    tag: 'Activité',
    summary: "Journal d'activité du projet",
    description:
      "Tout ce qui se passe sur le tableau, du plus récent au plus ancien. Paginé par curseur : tant que `nextBefore` n'est pas `null`, rappelez avec `?before=<nextBefore>`. Les actions faites par un agent portent `via` (nom du jeton).",
    params: PROJECT_ID,
    query: S.activityQuerySchema,
    ok: obj({ activities: arr(ref('Activity')), nextBefore: { oneOf: [int(), { type: 'null' }], description: 'Curseur de la page suivante, ou `null`.' } }),
  },
  {
    method: 'post',
    path: '/activities/{id}/comments',
    tag: 'Activité',
    permission: 'comment.create',
    summary: 'Commenter un évènement du journal',
    description: 'Les personnes mentionnées (`@[Nom](user:ID)`) sont notifiées. Diffusé en direct (`activity.comment`).',
    params: { id: "Identifiant de l'évènement." },
    body: S.activityCommentSchema,
    status: 201,
    ok: obj({ comment: ref('ActivityComment') }),
  },
  {
    method: 'patch',
    path: '/activity-comments/{id}',
    tag: 'Activité',
    permission: 'comment.create',
    summary: 'Modifier son commentaire du journal',
    params: { id: 'Identifiant du commentaire.' },
    body: S.activityCommentSchema,
    ok: obj({ comment: ref('ActivityComment') }),
  },
  {
    method: 'delete',
    path: '/activity-comments/{id}',
    tag: 'Activité',
    summary: 'Supprimer un commentaire du journal',
    description: 'Son auteur, ou une personne ayant `comment.moderate`. Suppression logique.',
    params: { id: 'Identifiant du commentaire.' },
    ok: obj({ comment: ref('ActivityComment') }),
  },

  // --- Membres ---------------------------------------------------------------------------------------------------------
  {
    method: 'post',
    path: '/projects/{id}/members',
    tag: 'Membres',
    permission: 'project.members',
    summary: 'Ajouter un membre',
    description: 'On ne peut attribuer qu\'un rôle dont les permissions sont incluses dans les siennes.',
    params: PROJECT_ID,
    body: S.memberSchema,
    status: 201,
    ok: ref('Ok'),
  },
  {
    method: 'patch',
    path: '/projects/{id}/members/{userId}',
    tag: 'Membres',
    permission: 'project.members',
    summary: "Changer le rôle d'un membre",
    params: { ...PROJECT_ID, userId: "Identifiant de l'utilisateur." },
    body: S.memberRoleSchema,
    ok: ref('Ok'),
  },
  {
    method: 'delete',
    path: '/projects/{id}/members/{userId}',
    tag: 'Membres',
    summary: 'Retirer un membre (ou quitter le projet soi-même)',
    description: "Nécessite `project.members`, sauf pour se retirer soi-même. Le dernier propriétaire ne peut pas partir.",
    params: { ...PROJECT_ID, userId: "Identifiant de l'utilisateur." },
    ok: ref('Ok'),
  },

  // --- Catégories ------------------------------------------------------------------------------------------------------
  {
    method: 'post',
    path: '/projects/{id}/categories',
    tag: 'Catégories',
    permission: 'project.edit',
    summary: 'Créer une catégorie',
    params: PROJECT_ID,
    body: S.categorySchema,
    status: 201,
    ok: obj({ category: ref('Category') }),
  },
  {
    method: 'patch',
    path: '/projects/{id}/categories/{categoryId}',
    tag: 'Catégories',
    permission: 'project.edit',
    summary: 'Modifier une catégorie',
    params: { ...PROJECT_ID, categoryId: 'Identifiant de la catégorie.' },
    body: S.categoryPatchSchema,
    ok: obj({ category: ref('Category') }),
  },
  {
    method: 'delete',
    path: '/projects/{id}/categories/{categoryId}',
    tag: 'Catégories',
    permission: 'project.edit',
    summary: 'Supprimer une catégorie',
    description: 'Les tickets concernés perdent leur catégorie.',
    params: { ...PROJECT_ID, categoryId: 'Identifiant de la catégorie.' },
    ok: ref('Ok'),
  },

  // --- Priorités et composants ----------------------------------------------------------------------------------------
  ...(['priority', 'component'] as const).flatMap((kind): Operation[] => {
    const plural = kind === 'priority' ? 'priorities' : 'components';
    const label = kind === 'priority' ? 'une priorité' : 'un composant';
    const tag = kind === 'priority' ? 'Priorités' : 'Composants';
    const params = { ...PROJECT_ID, [`${kind}Id`]: kind === 'priority' ? 'Identifiant de la priorité.' : 'Identifiant du composant.' };
    const schema = kind === 'priority' ? 'Priority' : 'Component';
    return [
      { method: 'post', path: `/projects/{id}/${plural}`, tag, permission: 'project.edit', summary: `Créer ${label}`, params: PROJECT_ID, body: S.listItemSchema, status: 201, ok: obj({ [kind]: ref(schema) }) },
      { method: 'patch', path: `/projects/{id}/${plural}/{${kind}Id}`, tag, permission: 'project.edit', summary: `Modifier ou déplacer ${label}`, params, body: S.listItemPatchSchema, ok: obj({ [kind]: ref(schema) }) },
      {
        method: 'delete',
        path: `/projects/{id}/${plural}/{${kind}Id}`,
        tag,
        permission: 'project.edit',
        summary: `Supprimer ${label}`,
        description: kind === 'priority' ? 'Les tickets concernés perdent leur priorité.' : 'Le composant est retiré des tickets.',
        params,
        ok: ref('Ok'),
      },
    ];
  }),

  // --- Livraisons ------------------------------------------------------------------------------------------------------
  {
    method: 'post',
    path: '/projects/{id}/deliveries',
    tag: 'Livraisons',
    permission: 'project.edit',
    summary: 'Créer une livraison',
    params: PROJECT_ID,
    body: S.deliverySchema,
    status: 201,
    ok: obj({ delivery: ref('Delivery') }),
  },
  {
    method: 'patch',
    path: '/projects/{id}/deliveries/{deliveryId}',
    tag: 'Livraisons',
    permission: 'project.edit',
    summary: 'Modifier une livraison',
    params: { ...PROJECT_ID, deliveryId: 'Identifiant de la livraison.' },
    body: S.deliveryPatchSchema,
    ok: obj({ delivery: ref('Delivery') }),
  },
  {
    method: 'delete',
    path: '/projects/{id}/deliveries/{deliveryId}',
    tag: 'Livraisons',
    permission: 'project.edit',
    summary: 'Supprimer une livraison',
    description: 'Les tickets concernés ne ciblent plus de livraison.',
    params: { ...PROJECT_ID, deliveryId: 'Identifiant de la livraison.' },
    ok: ref('Ok'),
  },

  // --- Tickets ---------------------------------------------------------------------------------------------------------
  {
    method: 'get',
    path: '/tickets/{id}',
    tag: 'Tickets',
    summary: 'Lire un ticket',
    params: TICKET_ID,
    ok: obj({ ticket: ref('Ticket'), key: str('Clé lisible, ex. `APP-12`.') }),
  },
  {
    method: 'get',
    path: '/tickets/{id}/preview',
    tag: 'Tickets',
    summary: 'Résumé d’un ticket',
    description: 'Ce qu’affiche le survol d’une mention : les noms y sont déjà résolus, et il se lit hors du contexte du projet.',
    params: TICKET_ID,
    ok: obj({ preview: ref('TicketPreview') }),
  },
  {
    method: 'patch',
    path: '/tickets/{id}',
    tag: 'Tickets',
    permission: 'ticket.edit',
    summary: 'Modifier un ticket',
    description:
      "Seuls les champs envoyés changent. Passer `status` à `done` termine le ticket ; `assigneeIds` remplace la liste des assignés (les parts des personnes conservées sont gardées). Pour **ordonner** une carte dans une colonne, utilisez plutôt `POST /tickets/{id}/move`.",
    params: TICKET_ID,
    body: S.updateTicketSchema,
    ok: obj({ ticket: ref('Ticket') }),
  },
  {
    method: 'delete',
    path: '/tickets/{id}',
    tag: 'Tickets',
    permission: 'ticket.delete',
    summary: 'Supprimer un ticket',
    params: TICKET_ID,
    ok: ref('Ok'),
  },
  {
    method: 'post',
    path: '/tickets/{id}/move',
    tag: 'Tickets',
    permission: 'ticket.edit',
    summary: 'Déplacer un ticket (colonne et rang) — action du Kanban',
    description: `Équivalent du glisser-déposer. \`status\` est la colonne cible (${TICKET_STATUSES.join(', ')}). \`beforeId\` : id du ticket **de la colonne cible** devant lequel insérer la carte ; \`null\` pour la placer en fin de colonne.`,
    params: TICKET_ID,
    body: S.moveTicketSchema,
    ok: obj({ ticket: ref('Ticket') }),
  },
  {
    method: 'post',
    path: '/tickets/{id}/transfer',
    tag: 'Tickets',
    permission: 'ticket.edit (projet d’origine) et ticket.create (projet cible)',
    summary: 'Déplacer un ticket vers un autre projet',
    description: "Le ticket reçoit un nouveau numéro. Catégorie, priorité, composants et livraison sont repris s'ils existent sous le même nom dans le projet cible ; les assignés non membres et les dépendances sont retirés. Commentaires, pièces jointes, sous-tâches et historique suivent.",
    params: TICKET_ID,
    body: S.transferTicketSchema,
    ok: obj({ ticket: ref('Ticket'), key: str('Nouvelle clé, ex. `OPS-4`.') }),
  },
  {
    method: 'get',
    path: '/tickets/{id}/history',
    tag: 'Tickets',
    summary: "Historique des modifications d'un ticket (du plus récent au plus ancien)",
    params: TICKET_ID,
    ok: obj({ history: arr(ref('HistoryEntry')) }),
  },

  // --- Documentation des équipes -----------------------------------------------------------------------------------------
  { method: 'get', path: '/documentation/spaces', tag: 'Espaces de documentation', summary: 'Espaces de documentation accessibles', ok: obj({ spaces: arr(ref('DocSpace')) }) },
  { method: 'post', path: '/documentation/spaces', tag: 'Espaces de documentation', permission: 'docs.create', summary: 'Créer un espace', body: S.docSpaceSchema, status: 201, ok: obj({ space: ref('DocSpace') }) },
  { method: 'get', path: '/documentation/spaces/{id}', tag: 'Espaces de documentation', summary: 'Espace, arbre, modèles et membres', description: '`templates` : modèles de notes de l’espace, à part de l’arbre `nodes`.', params: DOC_SPACE_ID, ok: obj({ space: ref('DocSpace'), nodes: arr(ref('DocNode')), templates: arr(ref('DocNode')), members: arr(ref('DocMember')) }) },
  { method: 'patch', path: '/documentation/spaces/{id}', tag: 'Espaces de documentation', permission: 'propriétaire de l’espace', summary: 'Renommer un espace', params: DOC_SPACE_ID, body: S.docSpaceUpdateSchema, ok: obj({ space: ref('DocSpace') }) },
  { method: 'delete', path: '/documentation/spaces/{id}', tag: 'Espaces de documentation', permission: 'propriétaire de l’espace', summary: 'Supprimer un espace et ses fichiers', params: DOC_SPACE_ID, ok: obj({ ok: bool() }) },
  { method: 'post', path: '/documentation/spaces/{id}/members', tag: 'Espaces de documentation', permission: 'propriétaire de l’espace', summary: 'Ajouter un membre', params: DOC_SPACE_ID, body: S.docMemberSchema, status: 201, ok: obj({ members: arr(ref('DocMember')) }) },
  { method: 'patch', path: '/documentation/spaces/{id}/members/{userId}', tag: 'Espaces de documentation', permission: 'propriétaire de l’espace', summary: 'Changer le rôle d’un membre', params: { ...DOC_SPACE_ID, userId: 'Identifiant du membre.' }, body: S.docMemberRoleSchema, ok: obj({ members: arr(ref('DocMember')) }) },
  { method: 'delete', path: '/documentation/spaces/{id}/members/{userId}', tag: 'Espaces de documentation', permission: 'propriétaire de l’espace', summary: 'Retirer un membre', params: { ...DOC_SPACE_ID, userId: 'Identifiant du membre.' }, ok: obj({ members: arr(ref('DocMember')) }) },
  {
    method: 'post',
    path: '/documentation/spaces/{id}/rescan',
    tag: 'Espaces de documentation',
    permission: 'propriétaire de l’espace',
    summary: 'Actualiser depuis le disque',
    description:
      'Relit le dossier de l’espace sur le serveur (`docs/<id>/`) : les notes (`.md`), images et dossiers ajoutés à la main entrent dans l’espace, les fichiers modifiés hors de FastBoard sont relus (une version garde le texte précédent), et ceux qui ont disparu passent à la corbeille. Les dossiers cachés sont ignorés, sauf `.templates` (modèles).',
    params: DOC_SPACE_ID,
    ok: obj({ result: obj({ added: int(), updated: int(), removed: int(), skipped: int('Fichiers ignorés : format non pris en charge, nom refusé, espace plein.') }), nodes: arr(ref('DocNode')), templates: arr(ref('DocNode')) }),
  },
  { method: 'get', path: '/documentation/spaces/{id}/trash', tag: 'Espaces de documentation', summary: 'Corbeille (15 jours)', params: DOC_SPACE_ID, ok: obj({ nodes: arr(ref('DocNode')) }) },
  { method: 'get', path: '/documentation/spaces/{id}/export', tag: 'Espaces de documentation', summary: 'Exporter un espace en ZIP', description: 'L’archive reproduit exactement l’arbre de l’espace, dossiers vides compris, et se lit comme un coffre Obsidian. Le texte exporté reste sur le serveur pour fusionner au retour.', params: DOC_SPACE_ID, okRaw: { contentType: 'application/zip', description: 'Archive de l’espace.' } },
  {
    method: 'post',
    path: '/documentation/spaces/{id}/import',
    tag: 'Espaces de documentation',
    permission: 'éditeur de l’espace',
    summary: 'Analyser un ZIP ou un fichier avant import',
    description: "**Le corps de la requête est l'archive** (octets bruts), ou un fichier seul (`.md`, image) nommé par l'en-tête `X-File-Name` : il devient une nouvelle note, ou la mise à jour de celle qui porte son nom. `?folder=` place le tout dans un dossier de l'espace. Rien n'est écrit : la réponse indique le sort de chaque fichier (`new`, `same`, `updated`, `kept`, `merged`, `conflict`, `removed`), à confirmer avec `POST …/import/{importId}/apply` sous 30 minutes.",
    params: DOC_SPACE_ID,
    rawBody: { contentType: 'application/zip', description: 'Archive ZIP (100 Mo maximum), ou fichier seul.' },
    ok: obj({ importId: str(), entries: arr({ type: 'object', description: 'path, kind, status, merged' }), ignored: arr(str()) }),
  },
  {
    method: 'post',
    path: '/documentation/nodes/{id}/import',
    tag: 'Espaces de documentation',
    permission: 'éditeur de l’espace',
    summary: 'Analyser le réimport d’un fichier',
    description: 'Le corps est le fichier lui-même. Il est comparé à ce fichier-ci, quel que soit son nom, puis s’applique comme un import de ZIP.',
    params: DOC_NODE_ID,
    rawBody: { contentType: 'application/octet-stream', description: 'Note ou image (10 Mo maximum).' },
    ok: obj({ importId: str(), entries: arr({ type: 'object', description: 'path, kind, status, merged' }), ignored: arr(str()) }),
  },
  { method: 'get', path: '/documentation/nodes/{id}/export', tag: 'Espaces de documentation', summary: 'Exporter un fichier ou un dossier', description: 'Un dossier donne un ZIP aux chemins de l’espace ; une note ou une image est renvoyée telle quelle.', params: DOC_NODE_ID, okRaw: { contentType: 'application/octet-stream', description: 'Fichier, ou archive ZIP.' } },
  { method: 'get', path: '/documentation/nodes/{id}/links', tag: 'Espaces de documentation', summary: 'Liens et rétroliens d’une note', description: 'Ce que la note cite (notes, tickets, tableaux blancs), et les notes, tickets et tableaux qui la citent, limités à ce que la personne peut voir.', params: DOC_NODE_ID, ok: ref('DocLinks') },
  { method: 'get', path: '/documentation/nodes/{id}/comments', tag: 'Espaces de documentation', summary: 'Commentaires d’une note', params: DOC_NODE_ID, ok: obj({ comments: arr(ref('DocComment')) }) },
  { method: 'post', path: '/documentation/nodes/{id}/comments', tag: 'Espaces de documentation', summary: 'Commenter un passage', description: 'Ouvert à tous les membres, lecteurs compris. Les personnes mentionnées qui ont accès à l’espace sont prévenues.', params: DOC_NODE_ID, body: S.docCommentSchema, status: 201, ok: obj({ comment: ref('DocComment') }) },
  { method: 'patch', path: '/documentation/comments/{id}', tag: 'Espaces de documentation', summary: 'Résoudre ou rouvrir un fil', params: { id: 'Identifiant du commentaire.' }, body: S.docCommentResolveSchema, ok: obj({ comment: ref('DocComment') }) },
  { method: 'delete', path: '/documentation/comments/{id}', tag: 'Espaces de documentation', permission: 'auteur ou propriétaire de l’espace', summary: 'Supprimer un commentaire', description: 'Ses réponses disparaissent avec lui.', params: { id: 'Identifiant du commentaire.' }, ok: obj({ ok: bool() }) },
  { method: 'get', path: '/documentation/spaces/{id}/import/{importId}/compare', tag: 'Espaces de documentation', permission: 'éditeur de l’espace', summary: 'Versions d’une note importée', description: 'Le texte du serveur, celui de l’import et le texte exporté d’où ils sont partis, s’il est encore connu : de quoi les comparer et choisir bloc par bloc.', params: { ...DOC_SPACE_ID, importId: 'Identifiant renvoyé par l’analyse.' }, query: S.docImportCompareSchema, ok: obj({ server: nullable(str()), incoming: nullable(str()), base: nullable(str()) }) },
  { method: 'post', path: '/documentation/spaces/{id}/import/{importId}/apply', tag: 'Espaces de documentation', permission: 'éditeur de l’espace', summary: 'Appliquer un import', params: { ...DOC_SPACE_ID, importId: 'Identifiant renvoyé par l’analyse.' }, body: S.docImportApplySchema, ok: obj({ written: int(), deleted: int() }) },
  {
    method: 'post',
    path: '/documentation/spaces/{id}/images',
    tag: 'Espaces de documentation',
    permission: 'éditeur de l’espace',
    summary: 'Ajouter une image',
    description: "**Le corps de la requête est l'image** (PNG, JPEG, WebP ou GIF, 10 Mo maximum) ; son nom passe par l'en-tête `X-File-Name` et le dossier de la note par `?folder=`. Elle est rangée dans le sous-dossier des images de l'espace (`imageFolder`, sinon celui de l'administration, `Pictures` par défaut), à côté de la note.",
    params: DOC_SPACE_ID,
    rawBody: { contentType: 'image/*', description: "Contenu binaire de l'image." },
    status: 201,
    ok: obj({ node: ref('DocNode') }),
  },
  { method: 'post', path: '/documentation/spaces/{id}/nodes', tag: 'Espaces de documentation', permission: 'éditeur de l’espace', summary: 'Créer une note, un dossier ou un modèle', description: 'Avec `fromId`, une note part d’un modèle de l’espace (variables remplies) et un modèle part d’une note.', params: DOC_SPACE_ID, body: S.docNodeSchema, status: 201, ok: obj({ node: ref('DocNode') }) },
  { method: 'get', path: '/documentation/nodes/{id}', tag: 'Espaces de documentation', summary: 'Lire un fichier', description: 'Le texte d’une note reflète l’édition en cours.', params: DOC_NODE_ID, ok: obj({ node: ref('DocNode'), role: str(), content: nullable(str()) }) },
  { method: 'patch', path: '/documentation/nodes/{id}', tag: 'Espaces de documentation', permission: 'éditeur de l’espace', summary: 'Renommer ou déplacer', params: DOC_NODE_ID, body: S.docMoveSchema, ok: obj({ node: ref('DocNode') }) },
  { method: 'delete', path: '/documentation/nodes/{id}', tag: 'Espaces de documentation', permission: 'éditeur de l’espace', summary: 'Mettre à la corbeille', description: 'Un dossier y part avec son contenu. La corbeille est vidée après 15 jours.', params: DOC_NODE_ID, ok: obj({ ok: bool() }) },
  { method: 'put', path: '/documentation/nodes/{id}/content', tag: 'Espaces de documentation', permission: 'éditeur de l’espace', summary: 'Remplacer le texte d’une note', description: 'Diffusé en direct aux personnes qui éditent la note.', params: DOC_NODE_ID, body: S.docContentSchema, ok: obj({ ok: bool() }) },
  { method: 'get', path: '/documentation/nodes/{id}/raw', tag: 'Espaces de documentation', summary: 'Contenu d’une image', params: DOC_NODE_ID, okRaw: { contentType: 'image/*', description: 'Image.' } },
  { method: 'post', path: '/documentation/nodes/{id}/restore', tag: 'Espaces de documentation', permission: 'éditeur de l’espace', summary: 'Sortir un fichier de la corbeille', params: DOC_NODE_ID, ok: obj({ node: ref('DocNode') }) },
  { method: 'get', path: '/documentation/nodes/{id}/versions', tag: 'Espaces de documentation', summary: 'Historique d’une note (15 jours)', params: DOC_NODE_ID, ok: obj({ versions: arr(ref('DocVersion')), retentionDays: int() }) },
  { method: 'get', path: '/documentation/versions/{id}', tag: 'Espaces de documentation', summary: 'Texte d’une version', params: { id: 'Identifiant de la version.' }, ok: obj({ content: str(), createdAt: dateTime() }) },
  { method: 'post', path: '/documentation/versions/{id}/restore', tag: 'Espaces de documentation', permission: 'éditeur de l’espace', summary: 'Restaurer une version', description: 'La version entière, ou le texte choisi bloc par bloc dans le comparateur (`content`).', params: { id: 'Identifiant de la version.' }, body: S.docRestoreSchema, ok: obj({ ok: bool() }) },
  { method: 'get', path: '/documentation/nodes/{id}/info', tag: 'Espaces de documentation', summary: 'Infos d’un fichier ou d’un dossier', description: 'Dates, auteur de la dernière modification, taille (contenu compris pour un dossier), mots et caractères d’une note.', params: DOC_NODE_ID, ok: ref('DocNodeInfo') },
  { method: 'put', path: '/documentation/nodes/{id}/memo', tag: 'Espaces de documentation', permission: 'éditeur de l’espace', summary: 'Écrire la note d’un fichier ou d’un dossier', params: DOC_NODE_ID, body: S.docMemoSchema, ok: obj({ node: ref('DocNode') }) },
  { method: 'get', path: '/documentation/bookmarks', tag: 'Espaces de documentation', summary: 'Mes favoris', description: 'Notes et images mises en favori, dans les espaces encore accessibles.', ok: obj({ bookmarks: arr(ref('DocBookmark')) }) },
  { method: 'put', path: '/documentation/nodes/{id}/bookmark', tag: 'Espaces de documentation', summary: 'Mettre un fichier en favori', params: DOC_NODE_ID, ok: obj({ bookmarks: arr(ref('DocBookmark')) }) },
  { method: 'delete', path: '/documentation/nodes/{id}/bookmark', tag: 'Espaces de documentation', summary: 'Retirer un fichier des favoris', params: DOC_NODE_ID, ok: obj({ bookmarks: arr(ref('DocBookmark')) }) },
  { method: 'get', path: '/documentation/spaces/{id}/site', tag: 'Espaces de documentation', permission: 'propriétaire de l’espace', summary: 'Site web de l’espace', params: DOC_SPACE_ID, ok: obj({ site: nullable(ref('DocSite')) }) },
  { method: 'put', path: '/documentation/spaces/{id}/site', tag: 'Espaces de documentation', permission: 'propriétaire de l’espace', summary: 'Activer ou régler le site web', description: 'Le site est un wiki en lecture seule à l’adresse `/wiki/{slug}`, qui suit l’espace en direct.', params: DOC_SPACE_ID, body: S.docSiteSchema, ok: obj({ site: ref('DocSite') }) },
  { method: 'delete', path: '/documentation/spaces/{id}/site', tag: 'Espaces de documentation', permission: 'propriétaire de l’espace', summary: 'Désactiver le site web', params: DOC_SPACE_ID, ok: obj({ ok: bool() }) },
  { method: 'get', path: '/wiki/{slug}', tag: 'Espaces de documentation', access: 'public', summary: 'Arbre d’un site web', description: 'Sans compte si le site est public ; sinon avec une session ou un jeton qui y donne accès.', params: { slug: 'Adresse du site.' }, ok: obj({ slug: str(), name: str(), description: str(), obsidian: bool(), nodes: arr(obj({ id: int(), path: str(), kind: str() })), updatedAt: dateTime(), editSpaceId: nullable(int()) }) },
  { method: 'get', path: '/wiki/{slug}/search', tag: 'Espaces de documentation', access: 'public', summary: 'Chercher dans un site web', description: 'Titres et chemins d’abord, puis le texte des pages ; 20 résultats au plus.', params: { slug: 'Adresse du site.' }, query: S.docSearchSchema, ok: obj({ results: arr(obj({ id: int(), path: str(), title: str(), excerpt: str() })) }) },
  { method: 'get', path: '/wiki/{slug}/pages/{id}', tag: 'Espaces de documentation', access: 'public', summary: 'Page d’un site web', params: { slug: 'Adresse du site.', id: 'Identifiant de la note.' }, ok: obj({ id: int(), path: str(), content: str(), updatedAt: dateTime() }) },
  { method: 'get', path: '/wiki/{slug}/files/{id}', tag: 'Espaces de documentation', access: 'public', summary: 'Image d’un site web', params: { slug: 'Adresse du site.', id: 'Identifiant de l’image.' }, okRaw: { contentType: 'image/*', description: 'Image.' } },
  { method: 'get', path: '/documentation/search', tag: 'Espaces de documentation', summary: 'Chercher une note par son chemin', query: S.docSearchSchema, ok: obj({ files: arr({ type: 'object', description: 'id, spaceId, spaceName, path, title' }) }) },

  // --- Tableaux blancs ------------------------------------------------------------------------------------------------
  { method: 'get', path: '/boards/spaces', tag: 'Tableaux blancs', summary: 'Espaces de tableaux accessibles', ok: obj({ spaces: arr(ref('BoardSpace')) }) },
  { method: 'post', path: '/boards/spaces', tag: 'Tableaux blancs', permission: 'boards.create', summary: 'Créer un espace de tableaux', body: S.boardSpaceSchema, status: 201, ok: obj({ space: ref('BoardSpace') }) },
  { method: 'get', path: '/boards/spaces/{id}', tag: 'Tableaux blancs', summary: 'Espace et son arbre', description: 'Dossiers et tableaux de l’espace, avec le rôle de la personne.', params: BOARD_SPACE_ID, ok: obj({ space: ref('BoardSpace'), role: str(), nodes: arr(ref('BoardNode')), members: arr(ref('DocMember')) }) },
  { method: 'patch', path: '/boards/spaces/{id}', tag: 'Tableaux blancs', permission: 'propriétaire de l’espace', summary: 'Renommer ou décrire un espace', params: BOARD_SPACE_ID, body: S.boardSpaceUpdateSchema, ok: obj({ space: ref('BoardSpace') }) },
  { method: 'delete', path: '/boards/spaces/{id}', tag: 'Tableaux blancs', permission: 'propriétaire de l’espace', summary: 'Supprimer un espace et tous ses tableaux', params: BOARD_SPACE_ID, ok: obj({ ok: bool() }) },
  { method: 'get', path: '/boards/spaces/{id}/members', tag: 'Tableaux blancs', summary: 'Membres d’un espace', params: BOARD_SPACE_ID, ok: obj({ members: arr(ref('DocMember')) }) },
  { method: 'post', path: '/boards/spaces/{id}/members', tag: 'Tableaux blancs', permission: 'propriétaire de l’espace', summary: 'Ajouter un membre', params: BOARD_SPACE_ID, body: S.boardMemberSchema, ok: obj({ members: arr(ref('DocMember')) }) },
  { method: 'put', path: '/boards/spaces/{id}/members/{userId}', tag: 'Tableaux blancs', permission: 'propriétaire de l’espace', summary: 'Changer le rôle d’un membre', params: { ...BOARD_SPACE_ID, userId: 'Identifiant de la personne.' }, body: S.boardMemberRoleSchema, ok: obj({ members: arr(ref('DocMember')) }) },
  { method: 'delete', path: '/boards/spaces/{id}/members/{userId}', tag: 'Tableaux blancs', summary: 'Retirer un membre (ou quitter l’espace)', description: 'Retirer quelqu’un d’autre est réservé aux propriétaires.', params: { ...BOARD_SPACE_ID, userId: 'Identifiant de la personne.' }, ok: obj({ members: arr(ref('DocMember')) }) },
  { method: 'post', path: '/boards/spaces/{id}/nodes', tag: 'Tableaux blancs', permission: 'éditeur de l’espace', summary: 'Créer un tableau ou un dossier', description: 'Les dossiers manquants du chemin sont créés. Un tableau peut partir d’éléments donnés.', params: BOARD_SPACE_ID, body: S.boardNodeSchema, status: 201, ok: obj({ node: ref('BoardNode') }) },
  { method: 'get', path: '/boards/spaces/{id}/trash', tag: 'Tableaux blancs', summary: 'Corbeille de l’espace', description: 'Tableaux supprimés depuis moins de 15 jours.', params: BOARD_SPACE_ID, ok: obj({ nodes: arr(ref('BoardNode')) }) },
  { method: 'patch', path: '/boards/nodes/{id}', tag: 'Tableaux blancs', permission: 'éditeur de l’espace', summary: 'Renommer ou déplacer', description: 'Un dossier emmène tout son contenu.', params: BOARD_NODE_ID, body: S.boardMoveSchema, ok: obj({ node: ref('BoardNode') }) },
  { method: 'delete', path: '/boards/nodes/{id}', tag: 'Tableaux blancs', permission: 'éditeur de l’espace', summary: 'Mettre à la corbeille', description: 'Un dossier y part avec son contenu.', params: BOARD_NODE_ID, ok: obj({ ok: bool() }) },
  { method: 'post', path: '/boards/nodes/{id}/restore', tag: 'Tableaux blancs', permission: 'éditeur de l’espace', summary: 'Sortir de la corbeille', params: BOARD_NODE_ID, ok: obj({ node: ref('BoardNode') }) },
  { method: 'post', path: '/boards/nodes/{id}/duplicate', tag: 'Tableaux blancs', permission: 'éditeur de l’espace', summary: 'Dupliquer un tableau', params: BOARD_ID, status: 201, ok: obj({ node: ref('BoardNode') }) },
  { method: 'get', path: '/boards/search', tag: 'Tableaux blancs', summary: 'Chercher un tableau', description: 'Par son nom, son chemin ou le texte de ses éléments, dans les espaces accessibles.', query: S.boardSearchSchema, ok: obj({ boards: arr(obj({ id: int(), spaceId: int(), spaceName: str(), path: str(), title: str() })) }) },
  { method: 'get', path: '/boards/nodes/{id}', tag: 'Tableaux blancs', summary: 'Lire un tableau', description: 'Ses éléments reflètent l’édition en cours.', params: BOARD_ID, ok: obj({ node: ref('BoardNode'), space: obj({ id: int(), name: str() }), role: str(), elements: arr({ type: 'object', description: 'Élément du tableau (voir le guide de l’API).' }) }) },
  { method: 'put', path: '/boards/nodes/{id}/elements', tag: 'Tableaux blancs', permission: 'éditeur de l’espace', summary: 'Remplacer les éléments d’un tableau', description: 'Les personnes qui ont le tableau ouvert voient le changement aussitôt.', params: BOARD_ID, body: S.boardElementsSchema, ok: obj({ count: int() }) },
  { method: 'get', path: '/boards/nodes/{id}/share', tag: 'Tableaux blancs', permission: 'propriétaire de l’espace', summary: 'Partage d’un tableau', params: BOARD_ID, ok: obj({ share: nullable(ref('BoardShare')) }) },
  { method: 'put', path: '/boards/nodes/{id}/share', tag: 'Tableaux blancs', permission: 'propriétaire de l’espace', summary: 'Partager un tableau', description: 'En plus des membres de l’espace : aux personnes connectées, à une liste, ou à tout le monde sans compte (`public`), en lecture ou en écriture, avec un mot de passe au choix. Le tableau s’ouvre à l’adresse `/t/{slug}`.', params: BOARD_ID, body: S.boardShareSchema, ok: obj({ share: ref('BoardShare') }) },
  { method: 'delete', path: '/boards/nodes/{id}/share', tag: 'Tableaux blancs', permission: 'propriétaire de l’espace', summary: 'Ne plus partager un tableau', description: 'Le lien cesse de fonctionner, et ceux qui y sont entrés sortent du tableau.', params: BOARD_ID, ok: obj({ ok: bool() }) },
  { method: 'get', path: '/board-shares/{slug}', tag: 'Tableaux blancs', access: 'public', summary: 'Ouvrir un tableau partagé', description: 'Sans compte si le partage est public. Un mot de passe s’ouvre avec `POST /board-shares/{slug}/unlock`, puis l’accès rendu passe dans l’en-tête `X-Board-Share`. Le contenu se lit ensuite en temps réel (WebSocket, `board.join` avec `share`).', params: { slug: 'Adresse du partage.' }, ok: obj({ share: ref('BoardShareInfo') }) },
  { method: 'post', path: '/board-shares/{slug}/unlock', tag: 'Tableaux blancs', access: 'public', summary: 'Saisir le mot de passe d’un tableau partagé', description: 'Rend un accès valable quelques jours ; il cesse si le mot de passe change.', params: { slug: 'Adresse du partage.' }, body: S.boardUnlockSchema, ok: obj({ token: str('À passer dans l’en-tête `X-Board-Share`.') }) },
  { method: 'get', path: '/board-shares/{slug}/preview', tag: 'Tableaux blancs', access: 'public', summary: 'Aperçu SVG d’un tableau partagé', params: { slug: 'Adresse du partage.' }, okRaw: { contentType: 'image/svg+xml', description: 'Image SVG du tableau.' } },
  {
    method: 'get',
    path: '/boards/nodes/{id}/versions',
    tag: 'Tableaux blancs',
    summary: 'Historique d’un tableau',
    description: 'Ses versions, de la plus ancienne à la plus récente. `currentVersionId` : la version qui est l’état actuel du tableau, ou `null` si cet état n’est pas encore enregistré.',
    params: BOARD_ID,
    ok: obj({ versions: arr(ref('BoardVersion')), currentVersionId: nullable(int()) }),
  },
  {
    method: 'get',
    path: '/boards/nodes/{id}/versions/{versionId}',
    tag: 'Tableaux blancs',
    summary: 'Éléments d’une version',
    params: { ...BOARD_ID, versionId: 'Identifiant de la version.' },
    ok: obj({ version: ref('BoardVersion'), elements: arr({ type: 'object', description: 'Élément du tableau (voir le guide de l’API).' }) }),
  },
  {
    method: 'post',
    path: '/boards/nodes/{id}/versions/{versionId}/restore',
    tag: 'Tableaux blancs',
    permission: 'éditeur de l’espace',
    summary: 'Restaurer une version',
    description: 'Le tableau reprend les éléments de cette version ; l’état d’avant reste dans l’historique. Les personnes qui ont le tableau ouvert voient le changement aussitôt.',
    params: { ...BOARD_ID, versionId: 'Identifiant de la version.' },
    ok: obj({ count: int() }),
  },
  {
    method: 'post',
    path: '/boards/nodes/{id}/versions/{versionId}/fork',
    tag: 'Tableaux blancs',
    permission: 'éditeur de l’espace',
    summary: 'Créer un tableau à partir d’une version',
    description: 'Le nouveau tableau est rangé à côté de l’original.',
    params: { ...BOARD_ID, versionId: 'Identifiant de la version.' },
    body: S.boardForkSchema,
    status: 201,
    ok: obj({ node: ref('BoardNode') }),
  },
  { method: 'patch', path: '/boards/nodes/{id}/elements', tag: 'Tableaux blancs', permission: 'éditeur de l’espace', summary: 'Ajouter, remplacer ou retirer des éléments', description: 'Sans toucher aux autres éléments : ce que d’autres dessinent en même temps est gardé. Les personnes qui ont ouvert le tableau voient le changement aussitôt.', params: BOARD_ID, body: S.boardElementsPatchSchema, ok: obj({ count: int('Nombre d’éléments du tableau après la modification.') }) },
  { method: 'get', path: '/boards/spaces/{id}/assets', tag: 'Tableaux blancs', summary: 'Images et SVG de l’espace', description: 'Les fichiers envoyés dans l’espace, réutilisables dans tous ses tableaux (élément `image`, `asset` = clé).', params: BOARD_SPACE_ID, ok: obj({ assets: arr(ref('BoardAsset')) }) },
  {
    method: 'post',
    path: '/boards/spaces/{id}/assets',
    tag: 'Tableaux blancs',
    permission: 'éditeur de l’espace',
    summary: 'Envoyer une image ou un SVG dans l’espace',
    description: "**Le corps de la requête est le fichier** (PNG, JPEG, WebP, GIF ou SVG sans script, 10 Mo maximum) ; son nom passe par l'en-tête `X-File-Name`.",
    params: BOARD_SPACE_ID,
    rawBody: { contentType: 'image/*', description: 'Contenu binaire du fichier.' },
    status: 201,
    ok: obj({ asset: ref('BoardAsset') }),
  },
  { method: 'delete', path: '/boards/assets/{id}', tag: 'Tableaux blancs', permission: 'éditeur de l’espace', summary: 'Retirer une image de l’espace', description: 'Les éléments qui l’affichent montrent qu’elle manque.', params: { id: 'Identifiant de l’image.' }, ok: obj({ ok: bool() }) },
  { method: 'get', path: '/board-assets/{key}', tag: 'Tableaux blancs', access: 'public', summary: 'Lire une image d’espace', description: 'Sans compte : la clé, longue et aléatoire, donne l’accès (les visiteurs d’un tableau partagé voient ainsi ses images).', params: { key: 'Clé du fichier.' }, okRaw: { contentType: 'image/*', description: 'Le fichier.' } },
  { method: 'get', path: '/boards/icons', tag: 'Tableaux blancs', summary: 'Icônes ajoutées par les administrateurs', description: 'En plus de la bibliothèque intégrée (`icon: "lucide:{nom}"`).', ok: obj({ icons: arr(ref('BoardIcon')) }) },
  { method: 'get', path: '/board-icons/{id}', tag: 'Tableaux blancs', access: 'public', summary: 'Lire une icône ajoutée', params: { id: 'Identifiant de l’icône.' }, okRaw: { contentType: 'image/svg+xml', description: 'Le SVG de l’icône.' } },
  { method: 'get', path: '/boards/nodes/{id}/links', tag: 'Tableaux blancs', summary: 'Liens et rétroliens d’un tableau', description: 'Les notes et tickets qui le mentionnent, les tableaux qui le montrent dans un Fast Element, et ce que montrent ses propres Fast Elements, limités à ce que la personne peut voir.', params: BOARD_ID, ok: ref('BoardLinks') },
  { method: 'get', path: '/boards/nodes/{id}/preview', tag: 'Tableaux blancs', summary: 'Aperçu SVG d’un tableau', params: BOARD_ID, query: z.object({ width: z.number().int().min(120).max(1600).optional().describe('Largeur maximale en pixels (640 par défaut).'), theme: z.enum(['light', 'dark']).optional().describe('`dark` : couleurs du thème sombre.') }), okRaw: { contentType: 'image/svg+xml', description: 'Image SVG du tableau.' } },

  // --- Lignes d'avancement et dépendances -------------------------------------------------------------------------------
  {
    method: 'post',
    path: '/tickets/{id}/parts',
    tag: 'Avancement',
    permission: 'ticket.edit',
    summary: "Ajouter une ligne d'avancement",
    description: "Il faut un texte (`note`), une personne (`userId`) ou les deux. Une même personne peut avoir plusieurs lignes.",
    params: TICKET_ID,
    body: S.partCreateSchema,
    status: 201,
    ok: obj({ ticket: ref('Ticket') }),
  },
  {
    method: 'patch',
    path: '/parts/{id}',
    tag: 'Avancement',
    permission: 'ticket.edit (ou ticket.update_own_part pour le texte, l\'avancement et la fin de ses propres lignes)',
    summary: "Modifier, terminer, confier ou déplacer une ligne d'avancement",
    description: "Quand toutes les lignes sont terminées, le ticket passe automatiquement à `done` ; rouvrir une ligne d'un ticket `done` le repasse en `in_progress`.",
    params: { id: 'Identifiant de la ligne.' },
    body: S.partPatchSchema,
    ok: obj({ ticket: ref('Ticket') }),
  },
  { method: 'delete', path: '/parts/{id}', tag: 'Avancement', permission: 'ticket.edit', summary: "Supprimer une ligne d'avancement", params: { id: 'Identifiant de la ligne.' }, ok: obj({ ticket: ref('Ticket') }) },
  {
    method: 'post',
    path: '/tickets/{id}/links',
    tag: 'Dépendances',
    permission: 'ticket.edit',
    summary: 'Ajouter une dépendance vers un autre ticket du projet',
    description: `Raisons proposées : ${LINK_REASONS.map((reason) => `« ${reason} »`).join(', ')} ; tout autre texte court est accepté. Les dépendances entrantes se déduisent des autres tickets (\`links[].targetId\`).`,
    params: TICKET_ID,
    body: S.linkSchema,
    status: 201,
    ok: obj({ ticket: ref('Ticket') }),
  },
  { method: 'delete', path: '/links/{id}', tag: 'Dépendances', permission: 'ticket.edit', summary: 'Supprimer une dépendance', params: { id: 'Identifiant de la dépendance.' }, ok: obj({ ticket: ref('Ticket') }) },

  // --- Pièces jointes --------------------------------------------------------------------------------------------------
  {
    method: 'get',
    path: '/tickets/{id}/attachments',
    tag: 'Pièces jointes',
    summary: "Pièces jointes d'un ticket",
    params: TICKET_ID,
    ok: obj({ attachments: arr(ref('Attachment')) }),
  },
  {
    method: 'post',
    path: '/tickets/{id}/attachments',
    tag: 'Pièces jointes',
    permission: 'attachment.create',
    summary: 'Joindre un fichier à un ticket',
    description:
      "**Le corps de la requête est le fichier lui-même** (octets bruts, pas de multipart) : `curl -X POST --data-binary @rapport.pdf -H 'Content-Type: application/pdf' -H 'X-File-Name: rapport.pdf' …`. Le nom peut aussi être donné par `?name=`. Taille maximale : 25 Mo par fichier (413 au-delà), 30 fichiers par ticket. Les images sont reconnues d'après leur contenu ; tout le reste est servi en téléchargement.",
    params: TICKET_ID,
    query: S.uploadQuerySchema,
    extraParams: [{ name: 'X-File-Name', in: 'header', required: false, description: 'Nom du fichier, encodé avec `encodeURIComponent` (accents, espaces).', schema: { type: 'string' } }],
    rawBody: { contentType: 'application/octet-stream', description: 'Contenu binaire du fichier (n\'importe quel `Content-Type`, sauf `multipart/*`).' },
    status: 201,
    ok: obj({ attachment: ref('Attachment') }),
  },
  {
    method: 'post',
    path: '/tickets/{id}/attachment-links',
    tag: 'Pièces jointes',
    permission: 'attachment.create',
    summary: 'Ajouter un lien web ou un chemin de fichier aux pièces jointes',
    description: "`kind=url` : adresse http, https, ftp ou mailto. `kind=path` : chemin absolu d'un fichier ou d'un dossier (poste ou partage réseau).",
    params: TICKET_ID,
    body: S.attachmentLinkSchema,
    status: 201,
    ok: obj({ attachment: ref('Attachment') }),
  },
  {
    method: 'post',
    path: '/attachments/{id}/open',
    tag: 'Pièces jointes',
    access: 'session',
    summary: 'Ouvrir un lien « chemin » sur la machine du serveur',
    description: "Uniquement quand l'interface tourne sur la même machine que le serveur (requête depuis localhost) ; sinon `409 not_local`. Les exécutables ne sont pas lancés : leur dossier s'ouvre.",
    params: { id: 'Identifiant de la pièce jointe.' },
    ok: obj({ ok: bool(), revealed: bool('Le dossier a été ouvert à la place du fichier (exécutable).') }),
  },
  {
    method: 'get',
    path: '/attachments/{id}/download',
    tag: 'Pièces jointes',
    summary: 'Télécharger une pièce jointe',
    description: "`?inline=1` affiche l'image dans le navigateur (images PNG, JPEG, GIF et WebP uniquement) ; sinon le fichier est téléchargé.",
    params: { id: 'Identifiant de la pièce jointe.' },
    okRaw: { contentType: 'application/octet-stream', description: 'Contenu du fichier.' },
  },
  {
    method: 'delete',
    path: '/attachments/{id}',
    tag: 'Pièces jointes',
    permission: 'auteur de l\'envoi, ou attachment.moderate',
    summary: 'Supprimer une pièce jointe',
    params: { id: 'Identifiant de la pièce jointe.' },
    ok: ref('Ok'),
  },

  // --- Commentaires ----------------------------------------------------------------------------------------------------
  {
    method: 'get',
    path: '/tickets/{id}/comments',
    tag: 'Commentaires',
    summary: "Commentaires d'un ticket (à plat, `parentId` donne le fil)",
    params: TICKET_ID,
    ok: obj({ comments: arr(ref('Comment')) }),
  },
  {
    method: 'post',
    path: '/tickets/{id}/comments',
    tag: 'Commentaires',
    permission: 'comment.create',
    summary: 'Commenter un ticket ou répondre à un commentaire',
    params: TICKET_ID,
    body: S.commentSchema,
    status: 201,
    ok: obj({ comment: ref('Comment') }),
  },
  {
    method: 'patch',
    path: '/comments/{id}',
    tag: 'Commentaires',
    permission: 'comment.create',
    summary: 'Modifier son commentaire',
    params: { id: 'Identifiant du commentaire.' },
    body: S.commentEditSchema,
    ok: obj({ comment: ref('Comment') }),
  },
  {
    method: 'delete',
    path: '/comments/{id}',
    tag: 'Commentaires',
    summary: 'Supprimer un commentaire',
    description: "Son auteur, ou une personne ayant `comment.moderate`. Suppression logique : les réponses restent.",
    params: { id: 'Identifiant du commentaire.' },
    ok: obj({ comment: ref('Comment') }),
  },

  // --- Administration (interface uniquement) --------------------------------------------------------------------------
  { method: 'get', path: '/admin/users', tag: 'Administration', access: 'session', permission: 'users.view', summary: 'Lister les comptes', ok: obj({ users: arr(ref('AdminUser')), online: arr(int()) }) },
  { method: 'post', path: '/admin/users', tag: 'Administration', access: 'session', permission: 'users.create', summary: 'Créer un compte', body: S.createUserSchema, status: 201, ok: obj({ user: ref('AdminUser') }) },
  { method: 'patch', path: '/admin/users/{id}', tag: 'Administration', access: 'session', permission: 'users.edit', summary: 'Modifier un compte', params: ID, body: S.updateUserSchema, ok: obj({ user: ref('AdminUser') }) },
  { method: 'delete', path: '/admin/users/{id}', tag: 'Administration', access: 'session', permission: 'users.delete', summary: 'Supprimer un compte', params: ID, ok: ref('Ok') },
  { method: 'get', path: '/admin/roles', tag: 'Administration', access: 'session', permission: 'roles.manage', summary: 'Lister les rôles et le catalogue de permissions', ok: obj({ roles: arr(ref('Role')), catalog: { type: 'object', description: 'Permissions disponibles par périmètre (`global`, `project`).' } }) },
  { method: 'post', path: '/admin/roles', tag: 'Administration', access: 'session', permission: 'roles.manage', summary: 'Créer un rôle', body: S.createRoleSchema, status: 201, ok: obj({ role: ref('Role') }) },
  { method: 'patch', path: '/admin/roles/{id}', tag: 'Administration', access: 'session', permission: 'roles.manage', summary: 'Modifier un rôle', params: ID, body: S.updateRoleSchema, ok: obj({ role: ref('Role') }) },
  { method: 'delete', path: '/admin/roles/{id}', tag: 'Administration', access: 'session', permission: 'roles.manage', summary: 'Supprimer un rôle', params: ID, ok: ref('Ok') },
  { method: 'get', path: '/admin/tokens', tag: 'Administration', access: 'session', permission: 'tokens.manage', summary: "Lister les jetons d'API de tous les utilisateurs", ok: obj({ tokens: arr(ref('ApiToken')) }) },
  { method: 'patch', path: '/admin/tokens/{id}', tag: 'Administration', access: 'session', permission: 'tokens.manage', summary: "Renommer ou prolonger n'importe quel jeton", params: { id: 'Identifiant du jeton.' }, body: S.updateTokenSchema, ok: obj({ token: ref('ApiToken') }) },
  { method: 'delete', path: '/admin/tokens/{id}', tag: 'Administration', access: 'session', permission: 'tokens.manage', summary: "Révoquer n'importe quel jeton", params: { id: 'Identifiant du jeton.' }, ok: ref('Ok') },
  {
    method: 'get',
    path: '/admin/monitoring',
    tag: 'Administration',
    access: 'session',
    permission: 'monitoring.view',
    summary: "Indicateurs de performance de l'application",
    description: 'Trafic, erreurs, latences, routes les plus sollicitées, processeur, mémoire, retard de la boucle d\'évènements, WebSocket, SQLite et stockage sur la fenêtre demandée.',
    query: S.monitoringQuerySchema,
    ok: ref('MonitoringSnapshot'),
  },
  {
    method: 'get',
    path: '/admin/logs',
    tag: 'Administration',
    access: 'session',
    permission: 'logs.view',
    summary: 'Journaux du serveur',
    description: 'Du plus récent au plus ancien, paginé par curseur (`before` / `nextBefore`). `after=<id>` ne retourne que les entrées plus récentes (suivi en direct).',
    query: S.logQuerySchema,
    ok: obj({ logs: arr(ref('LogEntry')), nextBefore: { oneOf: [int(), { type: 'null' }] } }),
  },
  {
    method: 'get',
    path: '/admin/logs/export',
    tag: 'Administration',
    access: 'session',
    permission: 'logs.view',
    summary: 'Exporter les journaux filtrés (NDJSON)',
    description: 'Mêmes filtres que `GET /admin/logs`, jusqu\'à 5 000 entrées, une entrée JSON par ligne.',
    query: S.logQuerySchema,
    okRaw: { contentType: 'application/x-ndjson', description: 'Fichier NDJSON.' },
  },
  { method: 'get', path: '/admin/auth', tag: 'Administration', access: 'session', permission: 'auth.manage', summary: 'Réglages de la connexion LDAP (le mot de passe du compte de service n’est jamais renvoyé)', ok: obj({ ldap: { type: 'object', description: 'enabled, profile, host, port, security, verifyCertificate, caPath, timeoutSeconds, bindDn, hasBindPassword, searchBase, userFilter, emailAttribute, nameAttribute, loginLabel, defaultRoleId, linkExisting, updatedAt' } }) },
  {
    method: 'put',
    path: '/admin/auth',
    tag: 'Administration',
    access: 'session',
    permission: 'auth.manage',
    summary: 'Configurer la connexion par annuaire LDAP',
    description: "`bindPassword` absent garde le mot de passe enregistré, chaîne vide l'efface ; il est stocké chiffré. À la connexion, un compte local garde son mot de passe ; sinon la personne est cherchée dans l'annuaire, son mot de passe y est vérifié, et son compte est créé à la première connexion. Les mots de passe des personnes ne sont jamais enregistrés.",
    body: S.ldapSettingsSchema,
    ok: obj({ ldap: { type: 'object' }, app: ref('AppInfo') }),
  },
  {
    method: 'post',
    path: '/admin/auth/ldap/test',
    tag: 'Administration',
    access: 'session',
    permission: 'auth.manage',
    summary: 'Tester la connexion LDAP (valeurs du formulaire)',
    description: "Essaie la connexion, le compte de service puis, si `login` est fourni, la recherche et le mot de passe de ce compte. S'arrête à la première étape qui échoue ; rien n'est enregistré.",
    body: S.ldapTestSchema,
    ok: obj({ ok: bool(), step: str('Étape atteinte.', { enum: ['connection', 'bind', 'search', 'account', 'done'] }), message: str(), detail: nullable(str()), entry: nullable({ type: 'object', description: 'dn, email, name, attributes' }) }),
  },
  {
    method: 'get',
    path: '/admin/documentation',
    tag: 'Administration',
    access: 'session',
    permission: 'docs.manage',
    summary: 'État et réglages de la documentation',
    description: '`imageFolder` : sous-dossier, à côté de la note, où vont les images collées dans les espaces qui n’ont pas le leur ; `defaultImageFolder` : sa valeur d’usine.',
    ok: obj({ enabled: bool(), imageFolder: str(), defaultImageFolder: str(), spaces: int(), files: int(), bytes: int(), retentionDays: int() }),
  },
  { method: 'post', path: '/admin/board-icons', tag: 'Administration', permission: 'boards.manage', summary: 'Ajouter une icône pour tous les tableaux', body: S.boardIconSchema, status: 201, ok: obj({ icon: ref('BoardIcon') }) },
  { method: 'delete', path: '/admin/board-icons/{id}', tag: 'Administration', permission: 'boards.manage', summary: 'Retirer une icône ajoutée', params: { id: 'Identifiant de l’icône.' }, ok: obj({ ok: bool() }) },
  { method: 'get', path: '/admin/boards', tag: 'Administration', access: 'session', permission: 'boards.manage', summary: 'État des tableaux blancs', ok: obj({ enabled: bool(), spaces: int(), boards: int() }) },
  { method: 'put', path: '/admin/boards', tag: 'Administration', access: 'session', permission: 'boards.manage', summary: 'Activer ou couper les tableaux blancs', description: 'Couper ferme les salles d’édition ; les tableaux restent en base.', body: S.boardSettingsSchema, ok: obj({ enabled: bool(), app: ref('AppInfo') }) },
  { method: 'put', path: '/admin/documentation', tag: 'Administration', access: 'session', permission: 'docs.manage', summary: 'Régler la documentation', description: 'Seuls les champs envoyés changent. Désactiver ferme les salles d’édition ; les fichiers restent sur le serveur. Changer `imageFolder` ne déplace pas les images déjà rangées.', body: S.docSettingsSchema, ok: obj({ enabled: bool(), imageFolder: str(), app: ref('AppInfo') }) },
  { method: 'get', path: '/admin/ai', tag: 'Administration', access: 'session', permission: 'ai.manage', summary: "Réglages de l'assistant IA (les clés ne sont jamais renvoyées)", ok: obj({ settings: { type: 'object', description: 'enabled, providers (id, name, baseUrl, timeoutSeconds, models, hasKey, keyHint, verifyCertificate), defaultModel, maxSteps, maxTurns, updatedAt' } }) },
  {
    method: 'put',
    path: '/admin/ai',
    tag: 'Administration',
    access: 'session',
    permission: 'ai.manage',
    summary: "Configurer l'assistant IA (fournisseurs compatibles OpenAI v1)",
    description: "Par fournisseur : `apiKey` absent garde la clé actuelle, chaîne vide l'efface ; les clés sont stockées chiffrées. `maxSteps` : tours de réflexion (appels d'outils par question) ; `maxTurns` : tours de discussion transmis au modèle.",
    body: S.aiSettingsSchema,
    ok: obj({ settings: { type: 'object' }, app: ref('AppInfo') }),
  },
  {
    method: 'post',
    path: '/admin/ai/test',
    tag: 'Administration',
    access: 'session',
    permission: 'ai.manage',
    summary: 'Tester la connexion au fournisseur d’IA (valeurs du formulaire)',
    description: 'La clé saisie est utilisée si elle est fournie, sinon la clé enregistrée du fournisseur `providerId`.',
    body: S.aiProbeSchema,
    ok: obj({ ok: bool(), message: str() }),
  },
  {
    method: 'post',
    path: '/admin/ai/models',
    tag: 'Administration',
    access: 'session',
    permission: 'ai.manage',
    summary: 'Détecter les modèles du fournisseur (`GET /models`)',
    description: 'Capacités (vision, contexte, réflexion) devinées d’après le nom ou fournies par l’API, à vérifier.',
    body: S.aiProbeSchema,
    ok: obj({ models: arr({ type: 'object', description: 'id, label, vision, contextWindow, reasoning, ownedBy' }) }),
  },
  { method: 'put', path: '/admin/app', tag: 'Administration', access: 'session', permission: 'settings.manage', summary: "Changer le nom de l'application", body: S.appNameSchema, ok: ref('AppInfo') },
  {
    method: 'put',
    path: '/admin/app/logo',
    tag: 'Administration',
    access: 'session',
    permission: 'settings.manage',
    summary: "Changer le logo de l'application",
    rawBody: { contentType: 'image/png | image/jpeg | image/webp', description: 'Image (512 Ko maximum).' },
    ok: ref('AppInfo'),
  },
  { method: 'delete', path: '/admin/app/logo', tag: 'Administration', access: 'session', permission: 'settings.manage', summary: 'Revenir au logo par défaut', ok: ref('AppInfo') },
  { method: 'get', path: '/admin/maintenance', tag: 'Administration', access: 'session', permission: 'settings.manage', summary: 'Message de maintenance (même désactivé)', ok: obj({ maintenance: ref('Maintenance') }) },
  {
    method: 'put',
    path: '/admin/maintenance',
    tag: 'Administration',
    access: 'session',
    permission: 'settings.manage',
    summary: 'Afficher ou retirer le message de maintenance',
    description: 'Diffusé immédiatement à tous les utilisateurs connectés (WebSocket `app`) et affiché sur la page de connexion.',
    body: S.maintenanceSchema,
    ok: obj({ app: ref('AppInfo'), maintenance: ref('Maintenance') }),
  },
  { method: 'get', path: '/admin/backups', tag: 'Administration', access: 'session', permission: 'backups.manage', summary: 'Configuration, état et historique des sauvegardes', ok: ref('BackupOverview') },
  {
    method: 'put',
    path: '/admin/backups',
    tag: 'Administration',
    access: 'session',
    permission: 'backups.manage',
    summary: 'Enregistrer la configuration des sauvegardes',
    description: "Remplace la liste des destinations. Conservation : `all`, `count` {keep}, `age` {days}, `smart` (1W:1D,4W:1W,12M:1M) ou `custom` {rules} (« durée:intervalle », unités s m h D W M Y, `U` = tout garder).",
    body: S.backupConfigSchema,
    ok: ref('BackupOverview'),
  },
  { method: 'post', path: '/admin/backups/test-folder', tag: 'Administration', access: 'session', permission: 'backups.manage', summary: "Vérifier qu'un dossier est accessible en écriture", body: S.folderTestSchema, ok: obj({ ok: bool(), message: str() }) },
  {
    method: 'post',
    path: '/admin/backups/{destinationId}/run',
    tag: 'Administration',
    access: 'session',
    permission: 'backups.manage',
    summary: 'Lancer une sauvegarde maintenant',
    description: 'Attend la fin de la sauvegarde ; `run.status` vaut `success` ou `failed` (`message`).',
    params: { destinationId: 'Identifiant de la destination.' },
    stringParams: ['destinationId'],
    ok: obj({ run: ref('BackupRun'), overview: ref('BackupOverview') }),
  },
  { method: 'get', path: '/admin/service', tag: 'Administration', access: 'session', permission: 'system.manage', summary: "État de l'installation en tant que service", ok: obj({ status: { type: 'object', description: 'Plateforme, installation détectée, droits, commande lancée, fichiers et commandes prévus.' } }) },
  {
    method: 'post',
    path: '/admin/service',
    tag: 'Administration',
    access: 'session',
    permission: 'system.manage',
    summary: 'Installer, retirer, démarrer ou arrêter le service',
    description: 'Windows : tâche planifiée (ouverture de session ou démarrage de la machine) ; Linux : unité systemd ; macOS : launchd. Le service relance le serveur s\'il s\'arrête. `dryRun` retourne les commandes sans rien exécuter.',
    body: S.serviceActionSchema,
    ok: obj({ ok: bool(), dryRun: bool(), commands: arr(str()), output: str(), status: { type: 'object' } }),
  },
  {
    method: 'get',
    path: '/admin/https',
    tag: 'Administration',
    access: 'session',
    permission: 'system.manage',
    summary: 'Réglages HTTP / HTTPS et état du serveur HTTPS',
    ok: obj({ settings: { type: 'object', description: 'enabled, port, format, certPath, keyPath, caPath, pfxPath, hasPassphrase, redirectHttp, hsts, hstsMaxAgeDays, trustProxy' }, status: { type: 'object', description: 'httpPort, https (listening, port, error, certificate, loadedAt), requestSecure, disabledByEnv' } }),
  },
  {
    method: 'put',
    path: '/admin/https',
    tag: 'Administration',
    access: 'session',
    permission: 'system.manage',
    summary: 'Configurer HTTPS (appliqué sans redémarrer)',
    description: "Les certificats sont vérifiés avant d'être enregistrés, puis relus automatiquement quand leurs fichiers changent. Le port HTTP reste ouvert (redirigé vers HTTPS si demandé, sauf depuis la machine elle-même). Secours : `FASTBOARD_HTTPS=0` ignore ces réglages au démarrage.",
    body: S.httpsSettingsSchema,
    ok: obj({ settings: { type: 'object' }, status: { type: 'object' } }),
  },
  {
    method: 'post',
    path: '/admin/https/test',
    tag: 'Administration',
    access: 'session',
    permission: 'system.manage',
    summary: 'Vérifier des certificats (sans les enregistrer)',
    body: S.httpsTestSchema,
    ok: obj({ ok: bool(), message: str(), certificate: { type: 'object', description: 'subject, issuer, altNames, validFrom, validTo, daysLeft, selfSigned, fingerprint (ou null)' } }),
  },
  {
    method: 'post',
    path: '/admin/https/self-signed',
    tag: 'Administration',
    access: 'session',
    permission: 'system.manage',
    summary: 'Créer un certificat auto-signé',
    description: 'RSA 2048 / SHA-256, valable 825 jours, écrit dans le dossier `certs/` à côté de la base. Pour essayer HTTPS sur le réseau local : les navigateurs l’affichent comme non sécurisé tant qu’il n’est pas approuvé.',
    body: S.selfSignedSchema,
    ok: obj({ certPath: str(), keyPath: str(), certificate: { type: 'object' } }),
  },
];

function buildOperation(operation: Operation): Schema {
  const access = operation.access ?? 'any';
  const notes: string[] = [];
  if (operation.description) notes.push(operation.description);
  if (access === 'session') notes.push("**Accès : interface uniquement** (session). Refusé avec un jeton d'API (`403 session_required`).");
  if (operation.permission) notes.push(`**Permission requise :** \`${operation.permission}\`.`);
  if (access === 'any' && operation.method !== 'get') notes.push("Nécessite un jeton d'API de portée **`write`**.");

  const parameters: Schema[] = [];
  for (const name of [...operation.path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!)) {
    parameters.push({ name, in: 'path', required: true, description: operation.params?.[name] ?? 'Identifiant.', schema: operation.stringParams?.includes(name) ? str() : int() });
  }
  if (operation.query) parameters.push(...queryParameters(operation.query));
  if (operation.extraParams) parameters.push(...operation.extraParams);

  const responses: Record<string, Schema> = {};
  const status = String(operation.status ?? 200);
  responses[status] = operation.okRaw
    ? { description: operation.okRaw.description, content: { [operation.okRaw.contentType]: { schema: { type: 'string' } } } }
    : ok(operation.ok ?? ref('Ok'));
  if (operation.body || operation.query || operation.rawBody) responses['400'] = errorResponse('Requête invalide (voir `error.details`).');
  if (access !== 'public') responses['401'] = errorResponse("Non authentifié, jeton invalide, expiré ou révoqué.");
  if (access !== 'public') responses['403'] = errorResponse('Permission manquante, jeton en lecture seule ou opération réservée à l\'interface.');
  if (parameters.some((parameter) => parameter.in === 'path')) responses['404'] = errorResponse('Ressource introuvable (ou invisible pour vous).');

  return {
    tags: [operation.tag],
    summary: operation.summary,
    ...(notes.length ? { description: notes.join('\n\n') } : {}),
    operationId: `${operation.method}${operation.path.replace(/\{(\w+)\}/g, '_$1').replace(/[^a-zA-Z0-9_]+/g, '_')}`,
    ...(parameters.length ? { parameters } : {}),
    ...(operation.body
      ? { requestBody: { required: true, content: { 'application/json': { schema: jsonSchema(operation.body) } } } }
      : operation.rawBody
        ? { requestBody: { required: true, description: operation.rawBody.description, content: { [operation.rawBody.contentType]: { schema: { type: 'string', format: 'binary' } } } } }
        : {}),
    responses,
    security: access === 'public' ? [] : access === 'session' ? [{ cookieAuth: [] }] : [{ bearerAuth: [] }, { cookieAuth: [] }],
  };
}

const INTRO = `
API REST de **FastBoard** (suivi de projet : Kanban, liste, Gantt, activité). Tout ce que fait l'interface passe par cette API : un script ou une IA peut lire le tableau, créer et déplacer des tickets, commenter, déclarer l'avancement.

## Démarrage rapide (agent / script)

1. Un utilisateur crée un **jeton d'API** : *menu du compte → Jetons d'API*. Il choisit la portée (\`read\` ou \`write\`), les projets accessibles et l'expiration. Le secret (\`fb_…\`) n'est affiché qu'une fois.
2. Chaque requête envoie \`Authorization: Bearer fb_…\`.
3. \`GET /me\` confirme l'identité et les limites du jeton, \`GET /projects\` liste les projets accessibles, \`GET /projects/{id}\` charge un tableau complet.

## Conventions

- Corps et réponses en JSON (UTF-8). Dates \`AAAA-MM-JJ\`, horodatages ISO 8601 UTC.
- Erreurs : \`{ "error": { "code", "message", "details"? } }\` avec le statut HTTP correspondant (400 validation, 401 authentification, 403 droits, 404 introuvable, 409 conflit, 429 trop de requêtes).
- Un jeton agit **avec les droits de son propriétaire**, jamais davantage. Un jeton \`read\` ne peut appeler que des routes \`GET\`.
- Débit limité par jeton (600 requêtes par minute par défaut) ; en-têtes \`X-RateLimit-*\` et \`Retry-After\`.
- Chaque action d'un jeton est attribuée à son propriétaire dans l'historique et le journal d'activité, avec la mention « via <nom d'affichage du jeton> ».
- Mentions dans les textes (description, commentaires) : \`@[Nom](user:12)\` pour une personne, \`@[APP-12](ticket:34)\` pour un ticket.
- Guide détaillé avec recettes : \`GET /docs/guide.md\`.
`.trim();

export function buildOpenApiDocument(): Schema {
  const paths: Record<string, Record<string, Schema>> = {};
  for (const operation of OPERATIONS) {
    (paths[operation.path] ??= {})[operation.method] = buildOperation(operation);
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'FastBoard API',
      version: APP_VERSION,
      description: INTRO,
    },
    servers: [{ url: '/api', description: 'Serveur courant' }],
    tags: [
      { name: 'Documentation' },
      { name: 'Authentification' },
      { name: "Jetons d'API" },
      { name: 'Profil' },
      { name: 'Projets' },
      { name: 'Tickets' },
      { name: 'Espaces de documentation' },
      { name: 'Tableaux blancs' },
      { name: 'Pièces jointes' },
      { name: 'Commentaires' },
      { name: 'Activité' },
      { name: 'Membres' },
      { name: 'Recherche' },
      { name: 'Notifications' },
      { name: 'Assistant IA' },
      { name: 'Sous-tâches' },
      { name: 'Dépendances' },
      { name: 'Catégories' },
      { name: 'Priorités' },
      { name: 'Composants' },
      { name: 'Livraisons' },
      { name: 'Administration', description: "Interface uniquement : refusé avec un jeton d'API." },
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'fb_…',
          description: "Jeton d'API personnel (menu du compte → Jetons d'API). Recommandé pour les scripts et les IA.",
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'fb_session',
          description: "Session de l'interface web (cookie posé par `POST /auth/login`). Dans Swagger UI, vous êtes déjà authentifié si vous êtes connecté à FastBoard dans ce navigateur.",
        },
      },
      schemas: componentSchemas,
    },
  };
}

/** Couples (méthode, chemin) documentés — utilisés par le test de non-divergence. */
export function documentedOperations(): Array<{ method: Method; path: string }> {
  return OPERATIONS.map(({ method, path }) => ({ method, path }));
}

