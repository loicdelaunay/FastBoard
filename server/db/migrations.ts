import { DEFAULT_PRIORITIES } from '../../shared/constants.ts';
import type { Db } from './database.ts';

/** Migrations ordonnées ; `PRAGMA user_version` mémorise la dernière appliquée. */
const MIGRATIONS: ReadonlyArray<(db: Db) => void> = [
  (db) => {
    db.exec(`
      CREATE TABLE roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL CHECK (scope IN ('global', 'project')),
        key TEXT,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        permissions TEXT NOT NULL DEFAULT '[]',
        is_system INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE (scope, name)
      );
      CREATE UNIQUE INDEX idx_roles_key ON roles (scope, key) WHERE key IS NOT NULL;

      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role_id INTEGER NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
        is_active INTEGER NOT NULL DEFAULT 1,
        theme TEXT NOT NULL DEFAULT 'aura-indigo-light',
        avatar BLOB,
        avatar_mime TEXT,
        avatar_version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT
      );

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        user_agent TEXT
      );
      CREATE INDEX idx_sessions_user ON sessions (user_id);

      CREATE TABLE projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        key TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        archived INTEGER NOT NULL DEFAULT 0,
        owner_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
        ticket_seq INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE project_members (
        project_id INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        role_id INTEGER NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, user_id)
      );
      CREATE INDEX idx_members_user ON project_members (user_id);

      CREATE TABLE categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#6366f1',
        position INTEGER NOT NULL DEFAULT 0,
        UNIQUE (project_id, name)
      );

      CREATE TABLE deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#0ea5e9',
        position INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_deliveries_project ON deliveries (project_id);

      CREATE TABLE tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
        number INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'backlog',
        category_id INTEGER REFERENCES categories (id) ON DELETE SET NULL,
        delivery_id INTEGER REFERENCES deliveries (id) ON DELETE SET NULL,
        initial_delivery_id INTEGER REFERENCES deliveries (id) ON DELETE SET NULL,
        start_date TEXT,
        end_date TEXT,
        progress INTEGER NOT NULL DEFAULT 0,
        position REAL NOT NULL DEFAULT 0,
        created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        UNIQUE (project_id, number)
      );
      CREATE INDEX idx_tickets_board ON tickets (project_id, status, position);
      CREATE INDEX idx_tickets_delivery ON tickets (delivery_id);

      CREATE TABLE ticket_assignees (
        ticket_id INTEGER NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        done INTEGER NOT NULL DEFAULT 0,
        progress INTEGER NOT NULL DEFAULT 0,
        done_at TEXT,
        assigned_at TEXT NOT NULL,
        PRIMARY KEY (ticket_id, user_id)
      );
      CREATE INDEX idx_assignees_user ON ticket_assignees (user_id);

      CREATE TABLE ticket_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
        parent_id INTEGER REFERENCES ticket_comments (id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        deleted_at TEXT
      );
      CREATE INDEX idx_comments_ticket ON ticket_comments (ticket_id);

      CREATE TABLE ticket_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_history_ticket ON ticket_history (ticket_id);
    `);
  },

  // v2 : jetons d'API et journal d'activité des projets.
  (db) => {
    db.exec(`
      CREATE TABLE api_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        prefix TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        scope TEXT NOT NULL CHECK (scope IN ('read', 'write')),
        project_ids TEXT,
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        expires_at TEXT,
        revoked_at TEXT
      );
      CREATE INDEX idx_tokens_user ON api_tokens (user_id);

      CREATE TABLE activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
        via TEXT,
        grp TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_activities_project ON activities (project_id, id);
    `);

    // Les rôles système existants reçoivent les nouvelles permissions (une seule fois : l'administrateur peut ensuite les retirer).
    const grant = (roleKey: string, permissions: string[]): void => {
      const role = db.get<{ id: number; permissions: string }>("SELECT id, permissions FROM roles WHERE scope = 'global' AND key = ?", roleKey);
      if (!role) {
        return;
      }
      const current = JSON.parse(role.permissions) as string[];
      const next = [...new Set([...current, ...permissions])];
      db.run('UPDATE roles SET permissions = ? WHERE id = ?', JSON.stringify(next), role.id);
    };
    grant('admin', ['tokens.create', 'tokens.manage']);
    grant('member', ['tokens.create']);

    // Reprise de l'existant : l'historique des tickets et les commentaires alimentent le journal, dans l'ordre chronologique.
    interface Seed {
      projectId: number;
      userId: number | null;
      group: string;
      data: unknown;
      createdAt: string;
    }
    const seeds: Seed[] = [];
    const history = db.all<{ data: string; user_id: number | null; created_at: string; ticket_id: number; title: string; number: number; project_id: number; key: string }>(
      `SELECT h.data, h.user_id, h.created_at, t.id AS ticket_id, t.title, t.number, t.project_id, p.key
         FROM ticket_history h JOIN tickets t ON t.id = h.ticket_id JOIN projects p ON p.id = t.project_id`,
    );
    for (const row of history) {
      seeds.push({
        projectId: row.project_id,
        userId: row.user_id,
        group: 'ticket',
        createdAt: row.created_at,
        data: { kind: 'ticket', ticketId: row.ticket_id, ticketKey: `${row.key}-${row.number}`, ticketTitle: row.title, entry: JSON.parse(row.data) },
      });
    }
    const comments = db.all<{ body: string; user_id: number | null; created_at: string; parent_id: number | null; ticket_id: number; title: string; number: number; project_id: number; key: string }>(
      `SELECT c.body, c.user_id, c.created_at, c.parent_id, t.id AS ticket_id, t.title, t.number, t.project_id, p.key
         FROM ticket_comments c JOIN tickets t ON t.id = c.ticket_id JOIN projects p ON p.id = t.project_id
        WHERE c.deleted_at IS NULL`,
    );
    for (const row of comments) {
      seeds.push({
        projectId: row.project_id,
        userId: row.user_id,
        group: 'comment',
        createdAt: row.created_at,
        data: {
          kind: 'comment',
          action: 'created',
          ticketId: row.ticket_id,
          ticketKey: `${row.key}-${row.number}`,
          ticketTitle: row.title,
          excerpt: row.body.length > 160 ? `${row.body.slice(0, 159)}…` : row.body,
          reply: row.parent_id !== null,
        },
      });
    }
    seeds.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const seed of seeds) {
      db.run(
        'INSERT INTO activities (project_id, user_id, via, grp, data, created_at) VALUES (?, ?, NULL, ?, ?, ?)',
        seed.projectId,
        seed.userId,
        seed.group,
        JSON.stringify(seed.data),
        seed.createdAt,
      );
    }
  },

  // v3 : « mission » facultative de chaque assigné (ce que la personne doit faire sur le ticket).
  (db) => {
    db.exec("ALTER TABLE ticket_assignees ADD COLUMN note TEXT NOT NULL DEFAULT ''");
  },

  // v4 : pièces jointes des tickets (les fichiers sont stockés sur disque, seules les métadonnées sont en base).
  (db) => {
    db.exec(`
      CREATE TABLE ticket_attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        storage TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_attachments_ticket ON ticket_attachments (ticket_id);
    `);
    grantSystemRoles(db, 'project', { editor: ['attachment.create'], contributor: ['attachment.create'], manager: ['attachment.create', 'attachment.moderate'], owner: ['attachment.create', 'attachment.moderate'] });
  },

  // v5 : supervision (journaux du serveur et indicateurs de performance par minute).
  (db) => {
    db.exec(`
      CREATE TABLE app_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        level TEXT NOT NULL,
        source TEXT NOT NULL,
        message TEXT NOT NULL,
        user_id INTEGER,
        request_id TEXT,
        data TEXT
      );
      CREATE INDEX idx_logs_ts ON app_logs (ts);

      CREATE TABLE metrics_minutes (
        ts INTEGER PRIMARY KEY,
        data TEXT NOT NULL
      );
    `);
    grantSystemRoles(db, 'global', { admin: ['monitoring.view', 'logs.view'] });
  },
  // v6 : réglages du projet (automatisations, colonnes personnalisées), stockés en JSON.
  (db) => {
    db.exec("ALTER TABLE projects ADD COLUMN settings TEXT NOT NULL DEFAULT '{}'");
  },
  // v7 : langue de l'interface choisie par chaque utilisateur (NULL = suivre la langue du navigateur).
  (db) => {
    db.exec('ALTER TABLE users ADD COLUMN locale TEXT');
  },

  // v8 : priorités et composants par projet, sous-tâches, dépendances, inactivité, « via » dans l'historique,
  // jetons ré-affichables, réglages de l'application (sauvegardes) et historique des sauvegardes.
  (db) => {
    db.exec(`
      CREATE TABLE priorities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#6366f1',
        icon TEXT NOT NULL DEFAULT 'pi pi-flag',
        position INTEGER NOT NULL DEFAULT 0,
        UNIQUE (project_id, name)
      );
      CREATE TABLE components (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#6366f1',
        icon TEXT NOT NULL DEFAULT 'pi pi-box',
        position INTEGER NOT NULL DEFAULT 0,
        UNIQUE (project_id, name)
      );
      CREATE TABLE ticket_components (
        ticket_id INTEGER NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
        component_id INTEGER NOT NULL REFERENCES components (id) ON DELETE CASCADE,
        PRIMARY KEY (ticket_id, component_id)
      );
      CREATE INDEX idx_ticket_components_component ON ticket_components (component_id);
      CREATE TABLE ticket_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
        target_id INTEGER NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
        reason TEXT NOT NULL,
        created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        UNIQUE (ticket_id, target_id, reason)
      );
      CREATE INDEX idx_ticket_links_target ON ticket_links (target_id);
      CREATE TABLE ticket_subtasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        position REAL NOT NULL DEFAULT 0,
        assignee_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
        created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        done_at TEXT
      );
      CREATE INDEX idx_ticket_subtasks_ticket ON ticket_subtasks (ticket_id);
      ALTER TABLE tickets ADD COLUMN priority_id INTEGER REFERENCES priorities (id) ON DELETE SET NULL;
      ALTER TABLE tickets ADD COLUMN status_changed_at TEXT;
      UPDATE tickets SET status_changed_at = COALESCE(completed_at, updated_at);
      ALTER TABLE ticket_history ADD COLUMN via TEXT;
      ALTER TABLE api_tokens ADD COLUMN display_name TEXT;
      ALTER TABLE api_tokens ADD COLUMN secret_enc TEXT;
      CREATE TABLE app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE backup_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        destination_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        kind TEXT NOT NULL,
        set_id TEXT,
        file TEXT,
        size INTEGER,
        files INTEGER,
        manifest TEXT,
        trigger TEXT NOT NULL DEFAULT 'schedule',
        message TEXT
      );
      CREATE INDEX idx_backup_runs_destination ON backup_runs (destination_id, id);
    `);
    // Chaque projet existant reçoit les priorités par défaut.
    const projects = db.all<{ id: number }>('SELECT id FROM projects');
    for (const project of projects) {
      DEFAULT_PRIORITIES.forEach((priority, index) => {
        db.run('INSERT INTO priorities (project_id, name, color, icon, position) VALUES (?, ?, ?, ?, ?)', project.id, priority.name, priority.color, priority.icon, index);
      });
    }
    grantSystemRoles(db, 'global', { admin: ['backups.manage', 'system.manage'] });
  },

  // v9 : liens dans les pièces jointes, abonnements aux tickets, notifications, personnalisation de l'application.
  (db) => {
    db.exec(`
      ALTER TABLE ticket_attachments ADD COLUMN kind TEXT NOT NULL DEFAULT 'file';
      ALTER TABLE ticket_attachments ADD COLUMN url TEXT;
      CREATE TABLE ticket_watchers (
        ticket_id INTEGER NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (ticket_id, user_id)
      );
      CREATE INDEX idx_watchers_user ON ticket_watchers (user_id);
      CREATE TABLE notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        project_id INTEGER REFERENCES projects (id) ON DELETE CASCADE,
        ticket_id INTEGER REFERENCES tickets (id) ON DELETE SET NULL,
        actor_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
        via TEXT,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        read_at TEXT
      );
      CREATE INDEX idx_notifications_user ON notifications (user_id, id);
    `);
    // Les créateurs et les assignés suivent déjà leurs tickets.
    const now = new Date().toISOString();
    db.run('INSERT OR IGNORE INTO ticket_watchers (ticket_id, user_id, created_at) SELECT id, created_by, ? FROM tickets WHERE created_by IS NOT NULL', now);
    db.run('INSERT OR IGNORE INTO ticket_watchers (ticket_id, user_id, created_at) SELECT ticket_id, user_id, ? FROM ticket_assignees', now);
    grantSystemRoles(db, 'global', { admin: ['settings.manage'] });
  },

  // v10 : assistant IA (droits globaux et par projet).
  (db) => {
    grantSystemRoles(db, 'global', { admin: ['ai.use', 'ai.manage'], member: ['ai.use'] });
    grantSystemRoles(db, 'project', {
      owner: ['ai.read', 'ai.write'],
      manager: ['ai.read', 'ai.write'],
      editor: ['ai.read', 'ai.write'],
      contributor: ['ai.read'],
      viewer: ['ai.read'],
    });
  },

  // v11 : sous-tickets (parent dans le même projet) et conversations de l'assistant IA.
  (db) => {
    db.exec(`
      ALTER TABLE tickets ADD COLUMN parent_id INTEGER REFERENCES tickets (id) ON DELETE SET NULL;
      CREATE INDEX idx_tickets_parent ON tickets (parent_id);
      CREATE TABLE ai_conversations (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        context TEXT NOT NULL DEFAULT '{}',
        turns TEXT NOT NULL DEFAULT '[]',
        message_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_ai_conversations_user ON ai_conversations (user_id, updated_at);
    `);
  },

  // v12 : champs personnalisés des tickets, thèmes et polices personnalisés des utilisateurs.
  (db) => {
    db.exec(`
      ALTER TABLE tickets ADD COLUMN custom_fields TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE users ADD COLUMN appearance TEXT NOT NULL DEFAULT '{}';
    `);
  },
];

/** Ajoute des permissions aux rôles système existants (une seule fois : l'administrateur peut ensuite les retirer). */
function grantSystemRoles(db: Db, scope: 'global' | 'project', grants: Record<string, string[]>): void {
  for (const [roleKey, permissions] of Object.entries(grants)) {
    const role = db.get<{ id: number; permissions: string }>('SELECT id, permissions FROM roles WHERE scope = ? AND key = ?', scope, roleKey);
    if (!role) {
      continue;
    }
    const current = JSON.parse(role.permissions) as string[];
    if (current.includes('*')) {
      continue;
    }
    db.run('UPDATE roles SET permissions = ? WHERE id = ?', JSON.stringify([...new Set([...current, ...permissions])]), role.id);
  }
}

/** Applique les migrations en attente (jusqu'à `target` : utile pour tester une migration isolément). */
export function migrate(db: Db, target = MIGRATIONS.length): void {
  const row = db.get<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  for (let version = current; version < Math.min(target, MIGRATIONS.length); version++) {
    db.transaction(() => {
      MIGRATIONS[version]!(db);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    });
  }
}
