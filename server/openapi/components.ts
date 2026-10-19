/** Schémas JSON (OpenAPI 3.1) des objets retournés par l'API. */
import { TICKET_STATUSES } from '../../shared/constants.ts';

export type Schema = Record<string, unknown>;

export const str = (description?: string, extra: Schema = {}): Schema => ({ type: 'string', ...(description ? { description } : {}), ...extra });
export const int = (description?: string): Schema => ({ type: 'integer', ...(description ? { description } : {}) });
export const bool = (description?: string): Schema => ({ type: 'boolean', ...(description ? { description } : {}) });
export const date = (description?: string): Schema => str(description, { format: 'date', example: '2026-11-15' });
export const dateTime = (description?: string): Schema => str(description, { format: 'date-time' });
export const nullable = (schema: Schema): Schema => ({ oneOf: [schema, { type: 'null' }] });
export const arr = (items: Schema): Schema => ({ type: 'array', items });
export const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });

/** Objet dont toutes les propriétés sont obligatoires (sauf celles passées dans `optional`). */
export function obj(properties: Record<string, Schema>, optional: string[] = [], description?: string): Schema {
  return {
    type: 'object',
    ...(description ? { description } : {}),
    properties,
    required: Object.keys(properties).filter((key) => !optional.includes(key)),
  };
}

export const componentSchemas: Record<string, Schema> = {
  Error: obj({
    error: obj(
      {
        code: str('Code machine stable : `bad_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `rate_limited`, `invalid_token`, `token_read_only`, `session_required`…'),
        message: str('Message lisible (français).'),
        details: { description: 'Détail de validation : liste `{path, message}` pour les erreurs 400.' },
      },
      ['details'],
    ),
  }),
  Ok: obj({ ok: bool() }),
  TicketStatus: str('Statut du ticket (colonne du Kanban).', { enum: [...TICKET_STATUSES] }),

  UserSummary: obj({
    id: int(),
    name: str(),
    email: str(),
    avatarVersion: int('0 = pas d\'image ; sinon `GET /users/{id}/avatar?v=<version>`.'),
    isActive: bool(),
  }),
  Me: obj({
    id: int(),
    name: str(),
    email: str(),
    avatarVersion: int(),
    isActive: bool(),
    theme: str(),
    locale: nullable(str("Langue de l'interface : `fr`, `en` ou `null` (non choisie).", { enum: ['fr', 'en'] })),
    roleId: int(),
    roleName: str(),
    roleKey: nullable(str()),
    permissions: { ...arr(str()), description: 'Permissions globales (le joker `*` accorde tout).' },
  }),
  TokenInfo: obj(
    {
      id: int(),
      name: str(),
      scope: str('`read` ou `write`.', { enum: ['read', 'write'] }),
      projectIds: nullable(arr(int())),
    },
    [],
    "Jeton d'API utilisé par la requête (null si l'appel vient d'une session).",
  ),
  ApiToken: obj(
    {
      id: int(),
      name: str(),
      prefix: str('Début du jeton (non secret), ex. `fb_Ab3dEfGh`.'),
      scope: str('`read` : lecture seule. `write` : lecture et écriture.', { enum: ['read', 'write'] }),
      projectIds: nullable(arr(int())),
      createdAt: dateTime(),
      lastUsedAt: nullable(dateTime()),
      expiresAt: nullable(dateTime()),
      revokedAt: nullable(dateTime()),
      userId: int('Propriétaire (vue d\'administration).'),
      userName: str('Nom du propriétaire (vue d\'administration).'),
    },
    ['userId', 'userName'],
  ),
  Role: obj({
    id: int(),
    scope: str('', { enum: ['global', 'project'] }),
    key: nullable(str()),
    name: str(),
    description: str(),
    permissions: arr(str()),
    isSystem: bool(),
    locked: bool(),
    usage: int(),
  }),
  AdminUser: obj({
    id: int(),
    name: str(),
    email: str(),
    avatarVersion: int(),
    isActive: bool(),
    theme: str(),
    roleId: int(),
    roleName: str(),
    roleKey: nullable(str()),
    createdAt: dateTime(),
    lastLoginAt: nullable(dateTime()),
  }),

  Project: obj({
    id: int(),
    name: str(),
    key: str('Préfixe des tickets, ex. `APP` → `APP-12`.'),
    description: str(),
    archived: bool('Un projet archivé est en lecture seule.'),
    ownerId: nullable(int()),
    settings: obj({
      autoMoveDone: bool('Toutes les parts terminées → le ticket passe automatiquement dans la colonne « Terminé ».'),
      autoReopen: bool('Une part rouverte sur un ticket terminé le repasse « En cours ».'),
      confetti: bool('Confettis quand un ticket arrive dans « Terminé ».'),
      columns: arr(obj({ status: ref('TicketStatus'), label: str('Nom affiché de la colonne.'), color: str('#RRGGBB'), hidden: bool() })),
    }, [], "Réglages du projet : automatisations et colonnes du Kanban (ordre d'affichage, noms, couleurs)."),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
  ProjectSummary: {
    allOf: [
      ref('Project'),
      obj({
        memberCount: int(),
        ticketCount: int(),
        doneCount: int(),
        progress: int('Avancement global (0–100).'),
        myRoleId: nullable(int()),
        myRoleName: nullable(str()),
        memberPreview: arr(ref('UserSummary')),
      }),
    ],
  },
  ProjectMember: obj({ userId: int(), roleId: int(), joinedAt: dateTime() }),
  Category: obj({ id: int(), projectId: int(), name: str(), color: str('#RRGGBB'), position: int() }),
  Delivery: obj({
    id: int(),
    projectId: int(),
    name: str(),
    description: str(),
    startDate: date('Début de la livraison.'),
    endDate: date('Fin de la livraison.'),
    color: str('#RRGGBB'),
    position: int(),
  }),
  Assignee: obj({
    userId: int(),
    done: bool('La personne a terminé sa part.'),
    progress: int('Avancement personnel (0–100) ; compte pour 100 quand `done` est vrai.'),
    doneAt: nullable(dateTime()),
    note: str("Mission de la personne : ce qu'elle doit faire sur ce ticket (texte libre, vide si non renseignée)."),
  }),
  Ticket: obj({
    id: int(),
    projectId: int(),
    number: int('Numéro dans le projet : la clé lisible est `<clé du projet>-<number>`.'),
    title: str(),
    description: str(),
    status: ref('TicketStatus'),
    categoryId: nullable(int()),
    deliveryId: nullable(int('Livraison ciblée.')),
    initialDeliveryId: nullable(int('Première livraison ciblée (repère les tickets reportés).')),
    startDate: nullable(date()),
    endDate: nullable(date()),
    progress: int('Avancement manuel (utilisé seulement sans assigné).'),
    position: { type: 'number', description: "Rang dans la colonne (tri croissant)." },
    assignees: arr(ref('Assignee')),
    commentCount: int(),
    attachmentCount: int('Nombre de pièces jointes (`GET /tickets/{id}/attachments` pour les lister).'),
    createdBy: nullable(int()),
    createdAt: dateTime(),
    updatedAt: dateTime(),
    completedAt: nullable(dateTime()),
  }),
  Attachment: obj({
    id: int(),
    ticketId: int(),
    userId: nullable(int('Auteur de l\'envoi.')),
    name: str('Nom du fichier.'),
    mime: str('Type détecté par le serveur (les images sont vérifiées d\'après leur contenu).'),
    size: int('Taille en octets.'),
    createdAt: dateTime(),
  }),
  LogEntry: obj({
    id: int(),
    ts: dateTime(),
    level: str('', { enum: ['debug', 'info', 'warn', 'error'] }),
    source: str('`system`, `http`, `auth`, `admin`, `project`, `storage`, `db`, `realtime`.'),
    message: str(),
    userId: nullable(int()),
    userName: nullable(str()),
    requestId: nullable(str('Identifiant de requête (en-tête `X-Request-Id`).')),
    data: { description: 'Détails structurés (JSON) : route, durée, pile d\'appels…' },
  }),
  MonitoringSnapshot: obj(
    {
      range: str('', { enum: ['15m', '1h', '6h', '24h', '3d'] }),
      generatedAt: dateTime(),
      stepMs: int('Durée couverte par chaque point de `series`.'),
      overview: { type: 'object', description: 'Instantané : processus (mémoire, processeur), système, WebSocket, SQLite, stockage, journaux.' },
      summary: { type: 'object', description: 'Totaux de la fenêtre : requêtes, erreurs, latences (moyenne, p50, p95, p99, max), histogramme.' },
      series: { ...arr({ type: 'object' }), description: 'Série temporelle (un point par pas) : requêtes, erreurs, latences, processeur, mémoire, boucle d\'évènements, WebSocket, SQL.' },
      routes: { ...arr({ type: 'object' }), description: 'Statistiques par route : appels, erreurs 5xx, durée moyenne, p95, maximum.' },
      health: obj({ status: str('', { enum: ['ok', 'degraded', 'critical'] }), reasons: arr(str()) }),
    },
    [],
    "Indicateurs de performance de l'application.",
  ),
  Comment: obj({
    id: int(),
    ticketId: int(),
    userId: nullable(int()),
    parentId: nullable(int('Commentaire parent (réponse).')),
    body: str('Vide si le message a été supprimé.'),
    createdAt: dateTime(),
    updatedAt: nullable(dateTime()),
    deleted: bool(),
  }),
  HistoryEntry: obj({
    id: int(),
    ticketId: int(),
    userId: nullable(int()),
    createdAt: dateTime(),
    data: {
      type: 'object',
      description:
        'Selon `kind` : `created` {title, assignees?}, `updated` {changes:[{field, from, to}], auto?}, `assignees` {added, removed}, `part` {user, done?, progress?, note?}, `attachment` {action: added|removed, name, size}.',
      properties: { kind: str('', { enum: ['created', 'updated', 'assignees', 'part', 'attachment'] }) },
      required: ['kind'],
      additionalProperties: true,
    },
  }),
  Activity: obj({
    id: int(),
    projectId: int(),
    userId: nullable(int()),
    via: nullable(str("Nom du jeton d'API quand l'action vient de l'API (agent, script).")),
    group: str('', { enum: ['ticket', 'comment', 'config', 'member'] }),
    createdAt: dateTime(),
    data: {
      type: 'object',
      description:
        'Selon `kind` : `ticket` {ticketId, ticketKey, ticketTitle, entry: HistoryEntry.data}, `ticket_deleted`, `comment` {action, ticketKey, excerpt…}, `category`, `delivery`, `member`, `project`.',
      properties: { kind: str('', { enum: ['ticket', 'ticket_deleted', 'comment', 'category', 'delivery', 'member', 'project'] }) },
      required: ['kind'],
      additionalProperties: true,
    },
  }),
  ProjectSnapshot: obj({
    project: ref('Project'),
    members: arr(ref('ProjectMember')),
    users: arr(ref('UserSummary')),
    categories: arr(ref('Category')),
    deliveries: arr(ref('Delivery')),
    tickets: arr(ref('Ticket')),
    permissions: { ...arr(str()), description: 'Vos permissions effectives dans ce projet.' },
  }),
};
