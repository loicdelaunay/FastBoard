import { STATUS_META, TICKET_STATUSES, isTicketStatus, type TicketStatus } from '../../shared/constants.ts';
import { ticketProgress } from '../../shared/progress.ts';
import type { TicketDTO } from '../../shared/types.ts';
import type { Actor, AppContext } from '../context.ts';
import { HttpError, badRequest, forbidden, notFound } from '../http/errors.ts';
import { requireProject, resolveProjectAccess, type AuthUser, type ProjectAccess } from '../services/access.ts';
import { createComment, listComments } from '../services/comments.ts';
import { listHistory } from '../services/history.ts';
import { createLink } from '../services/links.ts';
import { buildSnapshot } from '../services/projects.ts';
import { visibleProjects } from '../services/search.ts';
import { createSubtask, requireSubtask, updateSubtask } from '../services/subtasks.ts';
import { createTicket, foldText, getTicketDTO, listTicketDTOs, moveTicket, requireTicket, ticketKeyOf, updateTicket, type UpdateTicketInput } from '../services/tickets.ts';

/** Ce que l'agent sait de la personne et de la page ouverte ; les droits sont revérifiés à chaque appel d'outil. */
export interface ToolContext {
  ctx: AppContext;
  user: AuthUser;
  actor: Actor;
  allowWrite: boolean;
  changes: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  write: boolean;
  /** Libellé court affiché dans le panneau pendant l'exécution. */
  label: (args: Record<string, unknown>) => string;
  run: (tool: ToolContext, args: Record<string, unknown>) => unknown;
}

const MAX_TEXT = 1_500;

function clip(text: string, max = MAX_TEXT): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

const TICKET_REF = {
  oneOf: [{ type: 'integer' }, { type: 'string' }],
  description: 'Identifiant numérique du ticket ou sa clé lisible (ex. « APP-12 »).',
};

// --- Droits ------------------------------------------------------------------------------------------------------------

function canRead(tool: ToolContext, projectId: number): ProjectAccess {
  const access = requireProject(tool.ctx, tool.user, projectId);
  if (!access.permissions.has('ai.read')) {
    throw forbidden("L'assistant IA n'a pas accès à ce projet (permission « Interroger l'IA sur le projet »).");
  }
  return access;
}

function canWrite(tool: ToolContext, projectId: number, permission: string): ProjectAccess {
  if (!tool.allowWrite) {
    throw forbidden("Modifications désactivées : la personne doit cocher « Autoriser les modifications » dans le panneau de l'assistant.");
  }
  const access = canRead(tool, projectId);
  if (!access.permissions.has('ai.write')) {
    throw forbidden("Dans ce projet, l'assistant n'est pas autorisé à modifier (permission « Laisser l'IA modifier le projet »).");
  }
  return requireProject(tool.ctx, tool.user, projectId, permission);
}

/** Projets que l'assistant peut lire pour cette personne. */
function readableProjects(tool: ToolContext) {
  return visibleProjects(tool.ctx.db, tool.user).filter((project) => resolveProjectAccess(tool.ctx.db, tool.user, project.id)?.permissions.has('ai.read'));
}

/** Retrouve un ticket par identifiant ou par clé « APP-12 » parmi les projets visibles. */
function resolveTicket(tool: ToolContext, ref: unknown) {
  if (typeof ref === 'number' || (typeof ref === 'string' && /^\d+$/.test(ref.trim()))) {
    return requireTicket(tool.ctx.db, Number(ref));
  }
  const match = typeof ref === 'string' ? /^([A-Za-z0-9]+)-(\d+)$/.exec(ref.trim()) : null;
  if (!match) throw badRequest('Référence de ticket invalide : utilisez son identifiant ou sa clé (ex. APP-12).');
  const project = readableProjects(tool).find((entry) => entry.key.toUpperCase() === match[1]!.toUpperCase());
  const row = project ? tool.ctx.db.get<{ id: number }>('SELECT id FROM tickets WHERE project_id = ? AND number = ?', project.id, Number(match[2])) : undefined;
  if (!row) throw notFound(`Ticket ${ref} introuvable.`);
  return requireTicket(tool.ctx.db, row.id);
}

// --- Présentation compacte ----------------------------------------------------------------------------------------------

interface Names {
  key: string;
  users: Map<number, string>;
  columns: Map<TicketStatus, string>;
  categories: Map<number, string>;
  priorities: Map<number, string>;
  components: Map<number, string>;
  deliveries: Map<number, string>;
  complete: readonly TicketStatus[];
}

function namesOf(tool: ToolContext, access: ProjectAccess): Names {
  const snapshot = buildSnapshot(tool.ctx.db, access);
  return {
    key: snapshot.project.key,
    users: new Map(snapshot.users.map((user) => [user.id, user.name])),
    columns: new Map(snapshot.project.settings.columns.map((column) => [column.status, column.label])),
    categories: new Map(snapshot.categories.map((entry) => [entry.id, entry.name])),
    priorities: new Map(snapshot.priorities.map((entry) => [entry.id, entry.name])),
    components: new Map(snapshot.components.map((entry) => [entry.id, entry.name])),
    deliveries: new Map(snapshot.deliveries.map((entry) => [entry.id, entry.name])),
    complete: snapshot.project.settings.completeStatuses,
  };
}

function ticketLine(ticket: TicketDTO, names: Names) {
  return {
    id: ticket.id,
    key: `${names.key}-${ticket.number}`,
    title: ticket.title,
    status: `${ticket.status} (${names.columns.get(ticket.status) ?? STATUS_META[ticket.status].label})`,
    priority: ticket.priorityId ? (names.priorities.get(ticket.priorityId) ?? null) : null,
    assignees: ticket.assignees.map((assignee) => names.users.get(assignee.userId) ?? `#${assignee.userId}`),
    progress: ticketProgress(ticket, names.complete),
    endDate: ticket.endDate,
    delivery: ticket.deliveryId ? (names.deliveries.get(ticket.deliveryId) ?? null) : null,
  };
}

function ticketDetail(tool: ToolContext, ticket: TicketDTO, names: Names) {
  const keyOf = (id: number) => {
    const other = tool.ctx.db.get<{ project_id: number; number: number }>('SELECT project_id, number FROM tickets WHERE id = ?', id);
    return other ? ticketKeyOf(tool.ctx.db, other) : `#${id}`;
  };
  return {
    ...ticketLine(ticket, names),
    projectId: ticket.projectId,
    description: clip(ticket.description, 6_000),
    category: ticket.categoryId ? (names.categories.get(ticket.categoryId) ?? null) : null,
    components: ticket.componentIds.map((id) => names.components.get(id) ?? `#${id}`),
    startDate: ticket.startDate,
    parts: ticket.assignees.map((assignee) => ({ userId: assignee.userId, name: names.users.get(assignee.userId), done: assignee.done, progress: assignee.progress, mission: assignee.note || undefined })),
    subtasks: ticket.subtasks.map((subtask) => ({ id: subtask.id, title: subtask.title, done: subtask.done, assignee: subtask.assigneeId ? names.users.get(subtask.assigneeId) : undefined })),
    dependencies: ticket.links.map((link) => ({ reason: link.reason, target: keyOf(link.targetId) })),
    comments: listComments(tool.ctx.db, ticket.id)
      .filter((comment) => !comment.deleted)
      .slice(-20)
      .map((comment) => ({ author: comment.userId ? names.users.get(comment.userId) : null, at: comment.createdAt, body: clip(comment.body, 800) })),
    recentHistory: listHistory(tool.ctx.db, ticket.id)
      .slice(0, 15)
      .map((entry) => ({ at: entry.createdAt, by: entry.userId ? names.users.get(entry.userId) : null, via: entry.via ?? undefined, change: entry.data })),
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    completedAt: ticket.completedAt,
  };
}

/** Accepte un identifiant ou un nom (casse et accents ignorés) pour une liste du projet. */
function pickByName(map: Map<number, string>, value: unknown, what: string): number | null {
  if (value === null || value === '' || value === undefined) return null;
  if (typeof value === 'number' && map.has(value)) return value;
  const wanted = foldText(String(value));
  for (const [id, name] of map) {
    if (foldText(name) === wanted) return id;
  }
  throw badRequest(`${what} inconnu(e) : « ${String(value)} ». Valeurs possibles : ${[...map.values()].join(', ') || 'aucune'}.`);
}

function pickUsers(names: Names, value: unknown): number[] {
  if (!Array.isArray(value)) throw badRequest('assignees doit être une liste de personnes.');
  return value.map((entry) => pickByName(names.users, entry, 'Personne')!).filter((id) => id !== null);
}

function pickStatus(value: unknown): TicketStatus {
  if (isTicketStatus(value)) return value;
  throw badRequest(`Statut inconnu : utilisez ${TICKET_STATUSES.join(', ')}.`);
}

function isoDate(value: unknown, field: string): string | null {
  if (value === null || value === '') return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  throw badRequest(`${field} doit être une date AAAA-MM-JJ (ou null).`);
}

function ticketFields(names: Names, args: Record<string, unknown>): UpdateTicketInput {
  const input: UpdateTicketInput = {};
  if (typeof args.title === 'string') input.title = args.title.trim().slice(0, 200);
  if (typeof args.description === 'string') input.description = args.description.slice(0, 20_000);
  if ('status' in args && args.status !== undefined) input.status = pickStatus(args.status);
  if ('priority' in args) input.priorityId = pickByName(names.priorities, args.priority, 'Priorité');
  if ('category' in args) input.categoryId = pickByName(names.categories, args.category, 'Catégorie');
  if ('delivery' in args) input.deliveryId = pickByName(names.deliveries, args.delivery, 'Livraison');
  if ('components' in args && Array.isArray(args.components)) input.componentIds = args.components.map((entry) => pickByName(names.components, entry, 'Composant')!).filter((id) => id !== null);
  if ('assignees' in args && args.assignees !== undefined) input.assigneeIds = pickUsers(names, args.assignees);
  if ('startDate' in args) input.startDate = isoDate(args.startDate, 'startDate');
  if ('endDate' in args) input.endDate = isoDate(args.endDate, 'endDate');
  if (typeof args.progress === 'number') input.progress = Math.max(0, Math.min(100, Math.round(args.progress)));
  return input;
}

const FIELD_PROPERTIES = {
  title: { type: 'string' },
  description: { type: 'string', description: 'Markdown. Mentions : @[Nom](user:ID) ou @[CLÉ-12](ticket:ID).' },
  status: { type: 'string', enum: [...TICKET_STATUSES] },
  priority: { type: ['string', 'null'], description: 'Nom de la priorité du projet (ou null).' },
  category: { type: ['string', 'null'], description: 'Nom de la catégorie (ou null).' },
  delivery: { type: ['string', 'null'], description: 'Nom de la livraison (ou null).' },
  components: { type: 'array', items: { type: 'string' }, description: 'Noms des composants (remplace la liste).' },
  assignees: { type: 'array', items: { type: 'string' }, description: 'Noms des membres assignés (remplace la liste).' },
  startDate: { type: ['string', 'null'], description: 'AAAA-MM-JJ' },
  endDate: { type: ['string', 'null'], description: 'AAAA-MM-JJ' },
  progress: { type: 'integer', minimum: 0, maximum: 100, description: 'Avancement manuel (tickets sans assigné).' },
};

// --- Recherche ---------------------------------------------------------------------------------------------------------

function searchTickets(tool: ToolContext, query: string, projectId: number | null, limit: number) {
  const tokens = foldText(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) throw badRequest('Indiquez des mots à rechercher.');
  const projects = readableProjects(tool).filter((project) => projectId === null || project.id === projectId);
  const results: Array<{ score: number; hit: Record<string, unknown> }> = [];
  for (const project of projects) {
    const access = canRead(tool, project.id);
    const names = namesOf(tool, access);
    for (const ticket of listTicketDTOs(tool.ctx.db, project.id)) {
      const key = `${project.key}-${ticket.number}`;
      const comments = listComments(tool.ctx.db, ticket.id).filter((comment) => !comment.deleted).map((comment) => comment.body);
      const fields: Record<string, string> = {
        key,
        title: ticket.title,
        description: ticket.description,
        status: `${ticket.status} ${names.columns.get(ticket.status) ?? ''}`,
        priority: ticket.priorityId ? (names.priorities.get(ticket.priorityId) ?? '') : '',
        category: ticket.categoryId ? (names.categories.get(ticket.categoryId) ?? '') : '',
        components: ticket.componentIds.map((id) => names.components.get(id) ?? '').join(' '),
        delivery: ticket.deliveryId ? (names.deliveries.get(ticket.deliveryId) ?? '') : '',
        assignees: ticket.assignees.map((assignee) => `${names.users.get(assignee.userId) ?? ''} ${assignee.note}`).join(' '),
        subtasks: ticket.subtasks.map((subtask) => subtask.title).join(' · '),
        dependencies: ticket.links.map((link) => link.reason).join(' '),
        comments: comments.join(' · '),
      };
      const folded = Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, foldText(value)]));
      const all = Object.values(folded).join(' \n ');
      if (!tokens.every((token) => all.includes(token))) continue;
      const matched = Object.keys(folded).filter((name) => tokens.some((token) => folded[name]!.includes(token)));
      const score = (folded.key === tokens.join(' ') ? 100 : 0) + (matched.includes('title') ? 10 : 0) + matched.length;
      const where = matched.find((name) => !['key', 'title'].includes(name));
      const snippetSource = where ? fields[where]! : '';
      const index = where ? foldText(snippetSource).indexOf(tokens.find((token) => folded[where]!.includes(token))!) : -1;
      results.push({
        score,
        hit: { ...ticketLine(ticket, names), project: project.name, matchedIn: matched, snippet: index >= 0 ? clip(snippetSource.slice(Math.max(0, index - 60), index + 160), 240) : undefined },
      });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return { total: results.length, tickets: results.slice(0, limit).map((entry) => entry.hit) };
}

// --- Catalogue d'outils ------------------------------------------------------------------------------------------------

export const TOOLS: ToolDefinition[] = [
  {
    name: 'list_projects',
    description: "Liste les projets que l'assistant peut lire, avec leur nombre de tickets.",
    parameters: { type: 'object', properties: {} },
    write: false,
    label: () => 'Liste des projets',
    run: (tool) =>
      readableProjects(tool).map((project) => ({
        id: project.id,
        key: project.key,
        name: project.name,
        archived: project.archived === 1,
        tickets: tool.ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM tickets WHERE project_id = ?', project.id)?.n ?? 0,
      })),
  },
  {
    name: 'get_project',
    description: 'Configuration et état d’un projet : colonnes, priorités, catégories, composants, livraisons, membres, tickets par colonne.',
    parameters: { type: 'object', properties: { projectId: { type: 'integer' } }, required: ['projectId'] },
    write: false,
    label: () => 'Lecture du projet',
    run: (tool, args) => {
      const access = canRead(tool, Number(args.projectId));
      const snapshot = buildSnapshot(tool.ctx.db, access);
      const byStatus = Object.fromEntries(snapshot.project.settings.columns.map((column) => [column.status, { label: column.label, count: snapshot.tickets.filter((ticket) => ticket.status === column.status).length }]));
      return {
        id: snapshot.project.id,
        key: snapshot.project.key,
        name: snapshot.project.name,
        description: clip(snapshot.project.description),
        archived: snapshot.project.archived,
        columns: byStatus,
        completeStatuses: snapshot.project.settings.completeStatuses,
        priorities: snapshot.priorities.map((entry) => entry.name),
        categories: snapshot.categories.map((entry) => entry.name),
        components: snapshot.components.map((entry) => entry.name),
        deliveries: snapshot.deliveries.map((entry) => ({ name: entry.name, startDate: entry.startDate, endDate: entry.endDate })),
        members: snapshot.users.map((user) => ({ id: user.id, name: user.name })),
        yourPermissions: [...access.permissions],
      };
    },
  },
  {
    name: 'list_tickets',
    description: 'Tickets d’un projet, filtrables par colonne, personne assignée, priorité ou texte. Retourne des lignes compactes.',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'integer' },
        status: { type: 'array', items: { type: 'string', enum: [...TICKET_STATUSES] } },
        assignee: { type: 'string', description: 'Nom d’un membre, ou « none » pour les tickets sans assigné.' },
        priority: { type: 'string' },
        text: { type: 'string', description: 'Mots à trouver dans le titre ou la description.' },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
      },
      required: ['projectId'],
    },
    write: false,
    label: () => 'Liste des tickets',
    run: (tool, args) => {
      const access = canRead(tool, Number(args.projectId));
      const names = namesOf(tool, access);
      const statuses = Array.isArray(args.status) ? args.status.filter(isTicketStatus) : [];
      const assignee = typeof args.assignee === 'string' && args.assignee !== 'none' ? pickByName(names.users, args.assignee, 'Personne') : null;
      const priority = typeof args.priority === 'string' ? pickByName(names.priorities, args.priority, 'Priorité') : null;
      const text = typeof args.text === 'string' ? foldText(args.text) : '';
      const tickets = listTicketDTOs(tool.ctx.db, access.project.id)
        .filter((ticket) => !statuses.length || statuses.includes(ticket.status))
        .filter((ticket) => (args.assignee === 'none' ? ticket.assignees.length === 0 : assignee === null || ticket.assignees.some((entry) => entry.userId === assignee)))
        .filter((ticket) => priority === null || ticket.priorityId === priority)
        .filter((ticket) => !text || foldText(`${ticket.title} ${ticket.description}`).includes(text))
        .sort((a, b) => a.number - b.number);
      const limit = Math.min(200, Math.max(1, Number(args.limit) || 60));
      return { total: tickets.length, tickets: tickets.slice(0, limit).map((ticket) => ticketLine(ticket, names)) };
    },
  },
  {
    name: 'get_ticket',
    description: 'Détail complet d’un ticket : description, parts, sous-tâches, dépendances, commentaires récents et historique.',
    parameters: { type: 'object', properties: { ticket: TICKET_REF }, required: ['ticket'] },
    write: false,
    label: (args) => `Lecture de ${String(args.ticket)}`,
    run: (tool, args) => {
      const row = resolveTicket(tool, args.ticket);
      const access = canRead(tool, row.project_id);
      return ticketDetail(tool, getTicketDTO(tool.ctx.db, row.id), namesOf(tool, access));
    },
  },
  {
    name: 'search',
    description:
      'Recherche dans les tickets sur tous les champs (clé, titre, description, commentaires, sous-tâches, assignés et leurs missions, priorité, catégorie, composants, livraison, dépendances). Tous les mots doivent apparaître. Sans projectId, cherche dans tous les projets lisibles.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, projectId: { type: 'integer' }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['query'] },
    write: false,
    label: (args) => `Recherche « ${clip(String(args.query ?? ''), 40)} »`,
    run: (tool, args) => searchTickets(tool, String(args.query ?? ''), args.projectId ? Number(args.projectId) : null, Math.min(50, Math.max(1, Number(args.limit) || 15))),
  },
  {
    name: 'create_ticket',
    description: 'Crée un ticket dans un projet.',
    parameters: { type: 'object', properties: { projectId: { type: 'integer' }, ...FIELD_PROPERTIES }, required: ['projectId', 'title'] },
    write: true,
    label: (args) => `Création de « ${clip(String(args.title ?? ''), 40)} »`,
    run: (tool, args) => {
      const access = canWrite(tool, Number(args.projectId), 'ticket.create');
      const names = namesOf(tool, access);
      const fields = ticketFields(names, args);
      if (!fields.title) throw badRequest('title est obligatoire.');
      const ticket = createTicket(tool.ctx, tool.actor, access.project.id, { ...fields, title: fields.title });
      tool.changes += 1;
      return { created: ticketLine(ticket, names) };
    },
  },
  {
    name: 'update_ticket',
    description: 'Modifie les champs d’un ticket (seuls les champs fournis changent). Pour changer de colonne, préférez move_ticket.',
    parameters: { type: 'object', properties: { ticket: TICKET_REF, ...FIELD_PROPERTIES }, required: ['ticket'] },
    write: true,
    label: (args) => `Modification de ${String(args.ticket)}`,
    run: (tool, args) => {
      const row = resolveTicket(tool, args.ticket);
      const access = canWrite(tool, row.project_id, 'ticket.edit');
      const names = namesOf(tool, access);
      const fields = ticketFields(names, args);
      if (!Object.keys(fields).length) throw badRequest('Aucun champ à modifier.');
      const ticket = updateTicket(tool.ctx, tool.actor, row.id, fields);
      tool.changes += 1;
      return { updated: ticketLine(ticket, names), fields: Object.keys(fields) };
    },
  },
  {
    name: 'move_ticket',
    description: 'Déplace un ticket dans une autre colonne du Kanban (en fin de colonne).',
    parameters: { type: 'object', properties: { ticket: TICKET_REF, status: { type: 'string', enum: [...TICKET_STATUSES] } }, required: ['ticket', 'status'] },
    write: true,
    label: (args) => `Déplacement de ${String(args.ticket)}`,
    run: (tool, args) => {
      const row = resolveTicket(tool, args.ticket);
      const access = canWrite(tool, row.project_id, 'ticket.edit');
      const ticket = moveTicket(tool.ctx, tool.actor, row.id, { status: pickStatus(args.status), beforeId: null });
      tool.changes += 1;
      return { moved: ticketLine(ticket, namesOf(tool, access)) };
    },
  },
  {
    name: 'add_comment',
    description: 'Ajoute un commentaire sur un ticket (Markdown léger, mentions @[Nom](user:ID)).',
    parameters: { type: 'object', properties: { ticket: TICKET_REF, body: { type: 'string' } }, required: ['ticket', 'body'] },
    write: true,
    label: (args) => `Commentaire sur ${String(args.ticket)}`,
    run: (tool, args) => {
      const row = resolveTicket(tool, args.ticket);
      canWrite(tool, row.project_id, 'comment.create');
      const body = String(args.body ?? '').trim();
      if (!body) throw badRequest('body est vide.');
      const comment = createComment(tool.ctx, tool.actor, row.id, { body: body.slice(0, 5_000) });
      tool.changes += 1;
      return { commentId: comment.id };
    },
  },
  {
    name: 'add_subtask',
    description: 'Ajoute une sous-tâche à un ticket.',
    parameters: { type: 'object', properties: { ticket: TICKET_REF, title: { type: 'string' }, assignee: { type: 'string', description: 'Nom d’un membre (facultatif).' } }, required: ['ticket', 'title'] },
    write: true,
    label: (args) => `Sous-tâche sur ${String(args.ticket)}`,
    run: (tool, args) => {
      const row = resolveTicket(tool, args.ticket);
      const access = canWrite(tool, row.project_id, 'ticket.edit');
      const names = namesOf(tool, access);
      const ticket = createSubtask(tool.ctx, tool.actor, row.id, {
        title: String(args.title ?? '').trim().slice(0, 300),
        assigneeId: typeof args.assignee === 'string' ? pickByName(names.users, args.assignee, 'Personne') : null,
      });
      tool.changes += 1;
      return { subtasks: ticket.subtasks.map((subtask) => ({ id: subtask.id, title: subtask.title, done: subtask.done })) };
    },
  },
  {
    name: 'set_subtask',
    description: 'Coche, décoche ou renomme une sous-tâche (identifiant donné par get_ticket).',
    parameters: { type: 'object', properties: { subtaskId: { type: 'integer' }, done: { type: 'boolean' }, title: { type: 'string' } }, required: ['subtaskId'] },
    write: true,
    label: () => 'Mise à jour d’une sous-tâche',
    run: (tool, args) => {
      const subtask = requireSubtask(tool.ctx.db, Number(args.subtaskId));
      canWrite(tool, requireTicket(tool.ctx.db, subtask.ticket_id).project_id, 'ticket.edit');
      const ticket = updateSubtask(tool.ctx, tool.actor, subtask.id, {
        ...(typeof args.done === 'boolean' ? { done: args.done } : {}),
        ...(typeof args.title === 'string' && args.title.trim() ? { title: args.title.trim().slice(0, 300) } : {}),
      });
      tool.changes += 1;
      return { subtasks: ticket.subtasks.map((entry) => ({ id: entry.id, title: entry.title, done: entry.done })) };
    },
  },
  {
    name: 'add_dependency',
    description: 'Ajoute une dépendance entre deux tickets du même projet (raison : « Bloqué par », « Bloque », « Dépend de », « Lié à », « Duplique »… ou texte libre).',
    parameters: { type: 'object', properties: { ticket: TICKET_REF, target: TICKET_REF, reason: { type: 'string' } }, required: ['ticket', 'target', 'reason'] },
    write: true,
    label: (args) => `Dépendance ${String(args.ticket)} → ${String(args.target)}`,
    run: (tool, args) => {
      const row = resolveTicket(tool, args.ticket);
      const target = resolveTicket(tool, args.target);
      canWrite(tool, row.project_id, 'ticket.edit');
      const ticket = createLink(tool.ctx, tool.actor, row.id, { targetId: target.id, reason: String(args.reason ?? 'Lié à').trim().slice(0, 60) });
      tool.changes += 1;
      return { dependencies: ticket.links.length };
    },
  },
];

/** Outils proposés au modèle : les outils d'écriture seulement si la personne a autorisé les modifications. */
export function availableTools(allowWrite: boolean): ToolDefinition[] {
  return TOOLS.filter((tool) => allowWrite || !tool.write);
}

/** Exécute un outil ; une erreur devient un message pour le modèle, pas un échec de la discussion. */
export function runTool(tool: ToolContext, name: string, rawArgs: string): { ok: boolean; result: unknown } {
  const definition = TOOLS.find((entry) => entry.name === name);
  if (!definition) return { ok: false, result: { error: `Outil inconnu : ${name}` } };
  let args: Record<string, unknown>;
  try {
    args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
  } catch {
    return { ok: false, result: { error: 'Arguments JSON invalides.' } };
  }
  try {
    return { ok: true, result: definition.run(tool, args) };
  } catch (error) {
    const message = error instanceof HttpError ? error.message : error instanceof Error ? error.message : String(error);
    return { ok: false, result: { error: message } };
  }
}

export function toolLabel(name: string, rawArgs: string): string {
  const definition = TOOLS.find((entry) => entry.name === name);
  try {
    return definition ? definition.label(rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {}) : name;
  } catch {
    return definition?.label({}) ?? name;
  }
}
