import { z } from 'zod';
import { badRequest } from './errors.ts';

z.config(z.locales.fr());

export { z };

/** Valide un corps de requête ; la première erreur sert de message, le détail suit dans `details`. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data ?? {});
  if (result.success) {
    return result.data;
  }
  const issues = result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
  const first = issues[0];
  const message = first ? (first.path ? `${first.path} : ${first.message}` : first.message) : 'Données invalides.';
  throw badRequest(message, issues);
}

/** Convertit un paramètre d'URL en entier strictement positif. */
export function idParam(value: unknown): number {
  const id = typeof value === 'string' && /^\d{1,12}$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw badRequest('Identifiant invalide.');
  }
  return id;
}
