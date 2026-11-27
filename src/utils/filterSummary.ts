import type { FilterId, TicketFilterValues } from '@shared/ticketFilters';
import { t } from '@/i18n';
import type { useProjectStore } from '@/stores/project';

type Project = ReturnType<typeof useProjectStore>;

/** Filtres lisibles : « Statuts : À faire, En cours », « En retard »… (un élément supprimé du projet est ignoré). */
export function describeFilters(values: TicketFilterValues, project: Project): string[] {
  const names = (ids: readonly FilterId[], lookup: (id: number) => string | undefined, none: string): string =>
    ids
      .map((id) => (id === 'none' ? none : lookup(id)))
      .filter((name): name is string => Boolean(name))
      .join(', ');
  const parts: string[] = [];
  if (values.search.trim()) parts.push(t('« {text} »', { text: values.search.trim() }));
  const statuses = values.statuses.map((status) => project.statusMeta(status).label).join(', ');
  if (statuses) parts.push(t('Statuts : {list}', { list: statuses }));
  const categories = names(values.categoryIds, (id) => project.categoriesById.get(id)?.name, t('Sans catégorie'));
  if (categories) parts.push(t('Catégories : {list}', { list: categories }));
  const deliveries = names(values.deliveryIds, (id) => project.deliveriesById.get(id)?.name, t('Sans livraison'));
  if (deliveries) parts.push(t('Livraisons : {list}', { list: deliveries }));
  const people = names(values.assigneeIds, (id) => project.usersById.get(id)?.name, t('Non assigné'));
  if (people) parts.push(t('Personnes : {list}', { list: people }));
  if (values.mineOnly) parts.push(t('Mes tickets'));
  if (values.overdueOnly) parts.push(t('En retard'));
  return parts;
}
