import { SYSTEM_ROLES } from '../../shared/permissions.ts';
import { hashPassword } from '../auth/password.ts';
import type { AppConfig } from '../config.ts';
import { nowIso, type Db } from './database.ts';

/** Crée les rôles système manquants et le compte super administrateur au premier démarrage. */
export async function seedSystem(db: Db, config: AppConfig): Promise<{ createdSuperAdmin: boolean }> {
  const now = nowIso();

  for (const role of SYSTEM_ROLES) {
    const existing = db.get<{ id: number }>('SELECT id FROM roles WHERE scope = ? AND key = ?', role.scope, role.key);
    if (!existing) {
      db.run(
        'INSERT INTO roles (scope, key, name, description, permissions, is_system, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)',
        role.scope,
        role.key,
        role.name,
        role.description,
        JSON.stringify(role.permissions),
        now,
      );
    } else if (role.locked) {
      // Les rôles verrouillés suivent toujours le catalogue (ex. nouvelles permissions du propriétaire).
      db.run('UPDATE roles SET permissions = ?, description = ? WHERE id = ?', JSON.stringify(role.permissions), role.description, existing.id);
    }
  }

  const { email, password, name } = config.superAdmin;
  const admin = db.get<{ id: number }>('SELECT id FROM users WHERE email = ? COLLATE NOCASE', email);
  if (admin) {
    return { createdSuperAdmin: false };
  }
  const role = db.get<{ id: number }>("SELECT id FROM roles WHERE scope = 'global' AND key = 'super_admin'");
  if (!role) {
    throw new Error('Rôle super_admin introuvable après le seed.');
  }
  db.run(
    'INSERT INTO users (email, name, password_hash, role_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    email,
    name,
    await hashPassword(password),
    role.id,
    now,
    now,
  );
  return { createdSuperAdmin: true };
}
