/**
 * Description OpenAPI 3.1 de l'API FastBoard.
 * Les corps de requête et les paramètres d'URL sont générés depuis les schémas de validation réels (`http/schemas.ts`) :
 * la documentation ne peut pas diverger des routes. Le test `openapi.test.ts` vérifie en plus que chaque route est décrite.
 */
import { LINK_REASONS, TICKET_STATUSES } from '../../shared/constants.ts';
import { APP_VERSION } from '../../shared/changelog.ts';
import { z } from '../http/validate.ts';
import * as S from '../http/schemas.ts';
import { arr, bool, componentSchemas, int, obj, ref, str, type Schema } from './components.ts';

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

  // --- Profil ----------------------------------------------------------------------------------------------------------
  { method: 'patch', path: '/me', tag: 'Profil', access: 'session', summary: 'Modifier mon nom ou mon thème', body: S.profileSchema, ok: obj({ user: ref('Me') }) },
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
    method: 'patch',
    path: '/tickets/{id}/assignees/{userId}',
    tag: 'Tickets',
    permission: 'ticket.update_own_part (sa propre part) ou ticket.edit (celle d\'un autre)',
    summary: "Déclarer l'avancement, la fin ou la mission de la part d'un assigné",
    description:
      "Quand toutes les parts sont terminées, le ticket passe automatiquement à `done` ; rouvrir une part d'un ticket `done` le repasse en `in_progress`. `note` décrit ce que la personne doit faire sur ce ticket (facultatif, visible de tous les membres).",
    params: { ...TICKET_ID, userId: "Identifiant de l'assigné." },
    body: S.partSchema,
    ok: obj({ ticket: ref('Ticket') }),
  },
  {
    method: 'get',
    path: '/tickets/{id}/history',
    tag: 'Tickets',
    summary: "Historique des modifications d'un ticket (du plus récent au plus ancien)",
    params: TICKET_ID,
    ok: obj({ history: arr(ref('HistoryEntry')) }),
  },

  // --- Sous-tâches et dépendances --------------------------------------------------------------------------------------
  {
    method: 'post',
    path: '/tickets/{id}/subtasks',
    tag: 'Sous-tâches',
    permission: 'ticket.edit',
    summary: 'Ajouter une sous-tâche',
    params: TICKET_ID,
    body: S.subtaskSchema,
    status: 201,
    ok: obj({ ticket: ref('Ticket') }),
  },
  {
    method: 'patch',
    path: '/subtasks/{id}',
    tag: 'Sous-tâches',
    permission: 'ticket.edit (ou ticket.update_own_part pour cocher une sous-tâche dont on est responsable)',
    summary: 'Modifier, cocher ou déplacer une sous-tâche',
    params: { id: 'Identifiant de la sous-tâche.' },
    body: S.subtaskPatchSchema,
    ok: obj({ ticket: ref('Ticket') }),
  },
  { method: 'delete', path: '/subtasks/{id}', tag: 'Sous-tâches', permission: 'ticket.edit', summary: 'Supprimer une sous-tâche', params: { id: 'Identifiant de la sous-tâche.' }, ok: obj({ ticket: ref('Ticket') }) },
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
      { name: 'Pièces jointes' },
      { name: 'Commentaires' },
      { name: 'Activité' },
      { name: 'Membres' },
      { name: 'Recherche' },
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

