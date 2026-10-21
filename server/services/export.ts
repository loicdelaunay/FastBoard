import { APP_VERSION } from '../../shared/changelog.ts';
import { STATUS_META } from '../../shared/constants.ts';
import { ticketProgress } from '../../shared/progress.ts';
import type { Db } from '../db/database.ts';
import type { ProjectAccess } from './access.ts';
import { listComments } from './comments.ts';
import { listHistory } from './history.ts';
import { buildSnapshot } from './projects.ts';
import { listAttachments } from './attachments.ts';

/** Nom de fichier sûr pour un export : clé du projet et date du jour. */
export function exportFileName(key: string, extension: 'json' | 'csv'): string {
  return `${key.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}

/** Export complet d'un projet : configuration, membres et tickets avec commentaires, pièces jointes (métadonnées) et historique. */
export function exportProjectJson(db: Db, access: ProjectAccess): unknown {
  const snapshot = buildSnapshot(db, access);
  const key = snapshot.project.key;
  return {
    app: 'FastBoard',
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    project: snapshot.project,
    members: snapshot.members.map((member) => {
      const user = snapshot.users.find((entry) => entry.id === member.userId);
      return { ...member, name: user?.name ?? null, email: user?.email ?? null };
    }),
    categories: snapshot.categories,
    priorities: snapshot.priorities,
    components: snapshot.components,
    deliveries: snapshot.deliveries,
    tickets: snapshot.tickets
      .sort((a, b) => a.number - b.number)
      .map((ticket) => ({
        key: `${key}-${ticket.number}`,
        ...ticket,
        comments: listComments(db, ticket.id),
        attachments: listAttachments(db, ticket.id),
        history: listHistory(db, ticket.id),
      })),
  };
}

function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  // Neutralise l'injection de formules dans les tableurs.
  const safe = /^[=+\-@\t\r]/.test(text) && Number.isNaN(Number(text)) ? `'${text}` : text;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Tickets d'un projet au format CSV (séparateur « ; », UTF-8 avec BOM : s'ouvre directement dans Excel). */
export function exportProjectCsv(db: Db, access: ProjectAccess): string {
  const snapshot = buildSnapshot(db, access);
  const settings = snapshot.project.settings;
  const name = <T extends { id: number; name: string }>(list: T[], id: number | null): string => (id === null ? '' : (list.find((entry) => entry.id === id)?.name ?? ''));
  const user = (id: number): string => snapshot.users.find((entry) => entry.id === id)?.name ?? '';
  const column = (status: keyof typeof STATUS_META): string => settings.columns.find((entry) => entry.status === status)?.label ?? STATUS_META[status].label;
  const header = ['Clé', 'Titre', 'Description', 'Statut', 'Priorité', 'Composants', 'Catégorie', 'Livraison', 'Début', 'Fin', 'Avancement (%)', 'Assignés', 'Sous-tâches', 'Dépendances', 'Commentaires', 'Pièces jointes', 'Créé le', 'Modifié le', 'Terminé le'];
  const rows = snapshot.tickets
    .sort((a, b) => a.number - b.number)
    .map((ticket) => [
      `${snapshot.project.key}-${ticket.number}`,
      ticket.title,
      ticket.description,
      column(ticket.status),
      name(snapshot.priorities, ticket.priorityId),
      ticket.componentIds.map((id) => name(snapshot.components, id)).join(', '),
      name(snapshot.categories, ticket.categoryId),
      name(snapshot.deliveries, ticket.deliveryId),
      ticket.startDate,
      ticket.endDate,
      ticketProgress(ticket, settings.completeStatuses),
      ticket.assignees.map((assignee) => user(assignee.userId)).join(', '),
      ticket.subtasks.length ? `${ticket.subtasks.filter((subtask) => subtask.done).length}/${ticket.subtasks.length}` : '',
      ticket.links.map((link) => {
        const target = snapshot.tickets.find((entry) => entry.id === link.targetId);
        return `${link.reason} ${target ? `${snapshot.project.key}-${target.number}` : '?'}`;
      }).join(', '),
      ticket.commentCount,
      ticket.attachmentCount,
      ticket.createdAt,
      ticket.updatedAt,
      ticket.completedAt,
    ]);
  return `﻿${[header, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n')}`;
}
