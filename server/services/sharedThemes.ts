import { randomBytes } from 'node:crypto';
import { normalizeCustomTheme, SHARED_THEMES_MAX, type SharedThemeDTO } from '../../shared/themes.ts';
import { hasPermission } from '../../shared/permissions.ts';
import type { AppContext } from '../context.ts';
import { nowIso } from '../db/database.ts';
import { badRequest, forbidden, notFound } from '../http/errors.ts';
import type { AuthUser } from './access.ts';
import { readSetting, writeSetting } from './appSettings.ts';

/**
 * Bibliothèque de thèmes du site : chacun y publie un de ses thèmes personnalisés, que les autres ajoutent à leurs
 * thèmes d'un clic. Rangée dans les réglages de l'application (pas besoin d'une table pour quelques dizaines de thèmes).
 */

const KEY = 'sharedThemes';

interface StoredTheme {
  id: string;
  theme: SharedThemeDTO['theme'];
  authorId: number | null;
  createdAt: string;
}

function stored(ctx: AppContext): StoredTheme[] {
  const list = readSetting<StoredTheme[]>(ctx.db, KEY);
  return Array.isArray(list) ? list : [];
}

export function listSharedThemes(ctx: AppContext): SharedThemeDTO[] {
  const names = new Map(ctx.db.all<{ id: number; name: string }>('SELECT id, name FROM users').map((row) => [row.id, row.name]));
  return stored(ctx).flatMap((entry) => {
    // Relu à chaque fois : un thème mal formé (réglage modifié à la main) n'est pas servi.
    const theme = normalizeCustomTheme(entry.theme, `custom-${entry.id}`);
    if (!theme) return [];
    const { id: _id, ...rest } = theme;
    return [{ id: entry.id, theme: rest, authorId: entry.authorId, authorName: entry.authorId === null ? '' : (names.get(entry.authorId) ?? ''), createdAt: entry.createdAt }];
  });
}

export function publishSharedTheme(ctx: AppContext, user: AuthUser, raw: unknown): SharedThemeDTO {
  const list = stored(ctx);
  if (list.length >= SHARED_THEMES_MAX) throw badRequest(`La bibliothèque est pleine (${SHARED_THEMES_MAX} thèmes) : retirez-en avant d’en publier.`);
  const id = randomBytes(6).toString('hex');
  const theme = normalizeCustomTheme(raw, `custom-${id}`);
  if (!theme) throw badRequest('Thème invalide.');
  const { id: _id, ...rest } = theme;
  const entry: StoredTheme = { id, theme: rest, authorId: user.id, createdAt: nowIso() };
  writeSetting(ctx.db, KEY, [entry, ...list]);
  ctx.logger.info('account', `Thème partagé : ${rest.label}`, { sharedThemeId: id }, user.id);
  return listSharedThemes(ctx).find((entry) => entry.id === id)!;
}

/** Retirer un thème : son auteur, ou qui personnalise l'application. */
export function removeSharedTheme(ctx: AppContext, user: AuthUser, id: string): void {
  const list = stored(ctx);
  const entry = list.find((candidate) => candidate.id === id);
  if (!entry) throw notFound('Thème introuvable.');
  if (entry.authorId !== user.id && !hasPermission(user.permissions, 'settings.manage')) throw forbidden();
  writeSetting(ctx.db, KEY, list.filter((candidate) => candidate.id !== id));
}
