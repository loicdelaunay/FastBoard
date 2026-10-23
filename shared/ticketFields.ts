/**
 * Champs des tickets réglables par projet (onglet « Ticket » des réglages) : champs standard qu'on peut masquer, et
 * champs personnalisés (libellé et type choisis par le projet). Masquer un champ ne supprime pas ses valeurs.
 */

/** Champs standard qu'un projet peut masquer (le titre et la colonne restent toujours visibles). */
export const TICKET_FIELDS = ['description', 'priority', 'category', 'components', 'delivery', 'dates', 'assignees', 'progress', 'attachments', 'subtasks', 'children', 'links', 'comments'] as const;
export type TicketFieldKey = (typeof TICKET_FIELDS)[number];

export const TICKET_FIELD_META: Record<TicketFieldKey, { label: string; icon: string }> = {
  description: { label: 'Description', icon: 'pi pi-align-left' },
  priority: { label: 'Priorité', icon: 'pi pi-flag' },
  category: { label: 'Catégorie', icon: 'pi pi-tag' },
  components: { label: 'Composants', icon: 'pi pi-box' },
  delivery: { label: 'Livraison', icon: 'pi pi-truck' },
  dates: { label: 'Dates de début et de fin', icon: 'pi pi-calendar' },
  assignees: { label: 'Assignés et parts', icon: 'pi pi-users' },
  progress: { label: 'Avancement', icon: 'pi pi-percentage' },
  attachments: { label: 'Pièces jointes', icon: 'pi pi-paperclip' },
  subtasks: { label: 'Sous-tâches', icon: 'pi pi-list-check' },
  children: { label: 'Sous-tickets', icon: 'pi pi-sitemap' },
  links: { label: 'Dépendances', icon: 'pi pi-link' },
  comments: { label: 'Commentaires', icon: 'pi pi-comments' },
};

export const CUSTOM_FIELD_TYPES = ['text', 'longtext', 'number', 'date', 'select', 'multiselect', 'checkbox', 'url', 'user'] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const CUSTOM_FIELD_TYPE_META: Record<CustomFieldType, { label: string; icon: string }> = {
  text: { label: 'Texte court', icon: 'pi pi-pencil' },
  longtext: { label: 'Texte long', icon: 'pi pi-align-left' },
  number: { label: 'Nombre', icon: 'pi pi-hashtag' },
  date: { label: 'Date', icon: 'pi pi-calendar' },
  select: { label: 'Liste (un choix)', icon: 'pi pi-list' },
  multiselect: { label: 'Liste (plusieurs choix)', icon: 'pi pi-check-square' },
  checkbox: { label: 'Case à cocher', icon: 'pi pi-check-circle' },
  url: { label: 'Lien web', icon: 'pi pi-external-link' },
  user: { label: 'Personne', icon: 'pi pi-user' },
};

export interface CustomFieldDef {
  /** Identifiant stable (`cf_…`), clé des valeurs dans `ticket.customFields`. */
  id: string;
  label: string;
  type: CustomFieldType;
  /** Choix proposés (listes). */
  options: string[];
  /** La valeur s'affiche sur la carte du Kanban. */
  showOnCard: boolean;
}

/** Valeur d'un champ personnalisé : texte, nombre, booléen, liste de choix ou identifiant de personne. */
export type CustomFieldValue = string | number | boolean | string[];

export const CUSTOM_FIELD_LIMITS = { fields: 30, labelMax: 40, options: 50, optionMax: 60, textMax: 500, longTextMax: 5_000 };

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function defaultTicketFields(): Record<TicketFieldKey, boolean> {
  return Object.fromEntries(TICKET_FIELDS.map((key) => [key, true])) as Record<TicketFieldKey, boolean>;
}

export function normalizeTicketFields(raw: unknown): Record<TicketFieldKey, boolean> {
  const source = isRecord(raw) ? raw : {};
  return Object.fromEntries(TICKET_FIELDS.map((key) => [key, source[key] !== false])) as Record<TicketFieldKey, boolean>;
}

export function normalizeCustomFields(raw: unknown): CustomFieldDef[] {
  const seen = new Set<string>();
  const fields: CustomFieldDef[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !/^cf_[a-z0-9]{1,24}$/.test(entry.id) || seen.has(entry.id)) continue;
    if (!(CUSTOM_FIELD_TYPES as readonly unknown[]).includes(entry.type)) continue;
    const label = typeof entry.label === 'string' ? entry.label.trim().slice(0, CUSTOM_FIELD_LIMITS.labelMax) : '';
    if (!label) continue;
    seen.add(entry.id);
    const type = entry.type as CustomFieldType;
    const options =
      type === 'select' || type === 'multiselect'
        ? [...new Set((Array.isArray(entry.options) ? entry.options : []).filter((option): option is string => typeof option === 'string').map((option) => option.trim().slice(0, CUSTOM_FIELD_LIMITS.optionMax)).filter(Boolean))].slice(0, CUSTOM_FIELD_LIMITS.options)
        : [];
    fields.push({ id: entry.id, label, type, options, showOnCard: entry.showOnCard === true });
    if (fields.length >= CUSTOM_FIELD_LIMITS.fields) break;
  }
  return fields;
}

/**
 * Vérifie et normalise une valeur saisie pour un champ ; `null` efface la valeur. Lève une erreur (message lisible)
 * si la valeur ne convient pas au type.
 */
export function coerceCustomValue(field: CustomFieldDef, value: unknown): CustomFieldValue | null {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return null;
  const fail = (expected: string): never => {
    throw new Error(`Valeur invalide pour « ${field.label} » : ${expected} attendu.`);
  };
  switch (field.type) {
    case 'text':
    case 'longtext': {
      if (typeof value !== 'string') return fail('un texte');
      const text = value.trim().slice(0, field.type === 'text' ? CUSTOM_FIELD_LIMITS.textMax : CUSTOM_FIELD_LIMITS.longTextMax);
      return text || null;
    }
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? value : fail('un nombre');
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fail('une date AAAA-MM-JJ');
    case 'checkbox':
      return typeof value === 'boolean' ? (value ? true : null) : fail('vrai ou faux');
    case 'url':
      return typeof value === 'string' && /^https?:\/\/\S+$/i.test(value.trim()) && value.length <= 2_000 ? value.trim() : fail('une adresse http(s)');
    case 'user':
      return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fail('un identifiant de personne');
    case 'select':
      return typeof value === 'string' && field.options.includes(value) ? value : fail(`un choix parmi ${field.options.join(', ') || '(aucun)'}`);
    case 'multiselect': {
      if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string' && field.options.includes(entry))) return fail(`des choix parmi ${field.options.join(', ') || '(aucun)'}`);
      return field.options.filter((option) => (value as string[]).includes(option));
    }
  }
}

/** Nouvel identifiant de champ personnalisé. */
export function newCustomFieldId(): string {
  return `cf_${Math.random().toString(36).slice(2, 10)}`;
}
