import type { ActivityData, ActivityDTO, ActivityGroup } from '../../shared/types.ts';
import type { Actor, AppContext } from '../context.ts';
import { nowIso, type Db, type SqlParam } from '../db/database.ts';

const GROUP_OF: Record<ActivityData['kind'], ActivityGroup> = {
  ticket: 'ticket',
  ticket_deleted: 'ticket',
  comment: 'comment',
  category: 'config',
  delivery: 'config',
  project: 'config',
  member: 'member',
};

interface ActivityRow {
  id: number;
  project_id: number;
  user_id: number | null;
  via: string | null;
  grp: ActivityGroup;
  data: string;
  created_at: string;
}

function toDTO(row: ActivityRow): ActivityDTO {
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    via: row.via,
    group: row.grp,
    data: JSON.parse(row.data) as ActivityData,
    createdAt: row.created_at,
  };
}

/** Enregistre un évènement du tableau dans le journal du projet et le diffuse en direct. */
export function logActivity(ctx: AppContext, actor: Actor, projectId: number, data: ActivityData): ActivityDTO {
  const createdAt = nowIso();
  const group = GROUP_OF[data.kind];
  const { lastInsertRowid } = ctx.db.run(
    'INSERT INTO activities (project_id, user_id, via, grp, data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    projectId,
    actor.userId,
    actor.via ?? null,
    group,
    JSON.stringify(data),
    createdAt,
  );
  const activity: ActivityDTO = { id: lastInsertRowid, projectId, userId: actor.userId, via: actor.via ?? null, group, data, createdAt };
  ctx.hub.publish(projectId, [{ type: 'activity.created', activity }], actor);
  return activity;
}

export interface ActivityQuery {
  limit: number;
  /** Curseur : ne retourne que les évènements antérieurs à cet identifiant. */
  before?: number;
  groups?: ActivityGroup[];
  userId?: number;
  /** Uniquement les actions faites via un jeton d'API. */
  viaApi?: boolean;
  ticketId?: number;
}

export function listActivities(db: Db, projectId: number, query: ActivityQuery): { activities: ActivityDTO[]; nextBefore: number | null } {
  const where = ['project_id = ?'];
  const params: SqlParam[] = [projectId];
  if (query.before !== undefined) {
    where.push('id < ?');
    params.push(query.before);
  }
  if (query.groups?.length) {
    where.push(`grp IN (${query.groups.map(() => '?').join(', ')})`);
    params.push(...query.groups);
  }
  if (query.userId !== undefined) {
    where.push('user_id = ?');
    params.push(query.userId);
  }
  if (query.viaApi) {
    where.push('via IS NOT NULL');
  }
  if (query.ticketId !== undefined) {
    where.push("json_extract(data, '$.ticketId') = ?");
    params.push(query.ticketId);
  }
  const rows = db.all<ActivityRow>(
    `SELECT * FROM activities WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`,
    ...params,
    query.limit + 1,
  );
  const page = rows.slice(0, query.limit);
  return { activities: page.map(toDTO), nextBefore: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null };
}
