/**
 * Jeu de données de démonstration (facultatif) : `npm run seed:demo`.
 * Crée quelques utilisateurs (mot de passe « demo1234 ») et un projet avec livraisons, tickets, commentaires.
 * Idempotent : ne fait rien si le projet de démonstration existe déjà.
 */
import { addDays, todayISO } from '../../shared/dates.ts';
import type { TicketStatus } from '../../shared/constants.ts';
import { loadConfig } from '../config.ts';
import type { Actor, AppContext } from '../context.ts';
import { Db } from '../db/database.ts';
import { migrate } from '../db/migrations.ts';
import { seedSystem } from '../db/seed.ts';
import { Logger } from '../monitoring/logger.ts';
import { Metrics } from '../monitoring/metrics.ts';
import { SecretBox } from '../auth/secretBox.ts';
import { Hub } from '../realtime/hub.ts';
import { getAuthUser } from '../services/access.ts';
import { createComment } from '../services/comments.ts';
import { addMember, createProject } from '../services/projects.ts';
import { createCategory, createDelivery } from '../services/projectConfig.ts';
import { createTicket, updatePart } from '../services/tickets.ts';
import { createUserByAdmin } from '../services/users.ts';

const PROJECT_NAME = 'Lancement application mobile';
const config = loadConfig();
const db = new Db(config.dbPath);
migrate(db);
await seedSystem(db, config);
const ctx: AppContext = {
  config,
  db,
  hub: new Hub(),
  logger: new Logger(db, { minLevel: 'error', toConsole: false }),
  metrics: new Metrics(db, { wsClients: () => 0 }),
  uploadsDir: config.uploadsDir ?? '',
  secrets: new SecretBox(config.dbPath),
};

if (db.get('SELECT 1 FROM projects WHERE name = ?', PROJECT_NAME)) {
  console.log('Le projet de démonstration existe déjà : rien à faire.');
  db.close();
  process.exit(0);
}

const adminRow = db.get<{ id: number }>('SELECT id FROM users WHERE email = ? COLLATE NOCASE', config.superAdmin.email)!;
const admin = getAuthUser(db, adminRow.id)!;
const roleId = (scope: string, key: string): number => db.get<{ id: number }>('SELECT id FROM roles WHERE scope = ? AND key = ?', scope, key)!.id;

const people: Record<string, number> = {};
for (const [name, email] of [
  ['Camille Durand', 'camille@demo.fr'],
  ['Hugo Martin', 'hugo@demo.fr'],
  ['Inès Lefèvre', 'ines@demo.fr'],
  ['Théo Bernard', 'theo@demo.fr'],
] as const) {
  const existing = db.get<{ id: number }>('SELECT id FROM users WHERE email = ? COLLATE NOCASE', email);
  people[name] = existing?.id ?? (await createUserByAdmin(ctx, admin, { email, name, password: 'demo1234', roleId: roleId('global', 'member') })).id;
}
const [camille, hugo, ines, theo] = [people['Camille Durand']!, people['Hugo Martin']!, people['Inès Lefèvre']!, people['Théo Bernard']!];

const owner = getAuthUser(db, camille)!;
const actor = (userId: number): Actor => ({ userId, origin: null });
const project = createProject(ctx, owner, { name: PROJECT_NAME, key: 'APP', description: "Application mobile de suivi de commandes : de la maquette à la mise en production." });

addMember(ctx, actor(camille), project.id, hugo, roleId('project', 'editor'));
addMember(ctx, actor(camille), project.id, ines, roleId('project', 'editor'));
addMember(ctx, actor(camille), project.id, theo, roleId('project', 'contributor'));
addMember(ctx, actor(camille), project.id, adminRow.id, roleId('project', 'manager'));

const categoryRows = db.all<{ id: number; name: string }>('SELECT id, name FROM categories WHERE project_id = ?', project.id);
const cat = (name: string): number => categoryRows.find((c) => c.name === name)!.id;
const designCategory = createCategory(ctx, actor(camille), project.id, { name: 'Design', color: '#ec4899' }).id;
const qaCategory = createCategory(ctx, actor(camille), project.id, { name: 'Recette', color: '#14b8a6' }).id;

const today = todayISO();
const d1 = createDelivery(ctx, actor(camille), project.id, { name: 'V1.0 — Beta privée', description: 'Fonctions essentielles', startDate: addDays(today, -35), endDate: addDays(today, 12), color: '#6366f1' });
const d2 = createDelivery(ctx, actor(camille), project.id, { name: 'V1.1 — Lancement public', description: 'Stabilisation et publication sur les stores', startDate: addDays(today, 13), endDate: addDays(today, 55), color: '#10b981' });
const d3 = createDelivery(ctx, actor(camille), project.id, { name: 'V2.0 — Paiement en ligne', startDate: addDays(today, 56), endDate: addDays(today, 110), color: '#f59e0b' });

interface Spec {
  title: string;
  status: TicketStatus;
  category: number;
  delivery?: number;
  start?: number;
  end?: number;
  assignees?: number[];
  done?: number[];
  progress?: Array<[number, number]>;
  description?: string;
}

const specs: Spec[] = [
  { title: 'Maquettes de l’écran de connexion', status: 'done', category: designCategory, delivery: d1.id, start: -34, end: -26, assignees: [ines], description: 'Variantes clair/sombre, états d’erreur.' },
  { title: 'Charte graphique et composants UI', status: 'done', category: designCategory, delivery: d1.id, start: -32, end: -18, assignees: [ines, camille], done: [ines, camille] },
  { title: 'Authentification par e-mail et mot de passe', status: 'done', category: cat('Fonctionnalité'), delivery: d1.id, start: -28, end: -14, assignees: [hugo], done: [hugo] },
  { title: 'Liste des commandes avec pagination', status: 'in_progress', category: cat('Fonctionnalité'), delivery: d1.id, start: -16, end: 3, assignees: [hugo, theo], done: [hugo], progress: [[theo, 55]] },
  { title: 'Détail d’une commande et suivi du colis', status: 'in_progress', category: cat('Fonctionnalité'), delivery: d1.id, start: -10, end: 8, assignees: [camille, hugo], progress: [[camille, 40], [hugo, 25]] },
  { title: 'Notifications push', status: 'blocked', category: cat('Fonctionnalité'), delivery: d1.id, start: -12, end: -2, assignees: [theo], progress: [[theo, 30]], description: 'En attente des certificats Apple.' },
  { title: 'Crash au démarrage sur Android 9', status: 'review', category: cat('Bug'), delivery: d1.id, start: -8, end: 0, assignees: [theo], progress: [[theo, 90]] },
  { title: 'Campagne de tests utilisateurs', status: 'todo', category: qaCategory, delivery: d1.id, start: 4, end: 11, assignees: [ines, camille] },
  { title: 'Mode hors ligne (cache local)', status: 'todo', category: cat('Fonctionnalité'), delivery: d2.id, start: 14, end: 30, assignees: [hugo] },
  { title: 'Recherche de commandes', status: 'todo', category: cat('Fonctionnalité'), delivery: d2.id, start: 16, end: 26, assignees: [theo] },
  { title: 'Optimiser le temps de chargement de la liste', status: 'backlog', category: cat('Tâche'), delivery: d2.id, start: 28, end: 36 },
  { title: 'Écran d’onboarding', status: 'in_progress', category: designCategory, delivery: d2.id, start: -3, end: 18, assignees: [ines], progress: [[ines, 35]] },
  { title: 'Rédaction des fiches stores (Apple / Google)', status: 'backlog', category: cat('Tâche'), delivery: d2.id, start: 38, end: 46, assignees: [camille] },
  { title: 'Campagne de recette finale', status: 'backlog', category: qaCategory, delivery: d2.id, start: 44, end: 54, assignees: [ines, theo] },
  { title: 'Soumission aux stores', status: 'backlog', category: cat('Tâche'), delivery: d2.id, start: 52, end: 55, assignees: [camille] },
  { title: 'Intégration du prestataire de paiement', status: 'backlog', category: cat('Fonctionnalité'), delivery: d3.id, start: 58, end: 85, assignees: [hugo, theo] },
  { title: 'Écrans du tunnel de paiement', status: 'backlog', category: designCategory, delivery: d3.id, start: 58, end: 72, assignees: [ines] },
  { title: 'Audit de sécurité', status: 'backlog', category: qaCategory, delivery: d3.id },
  { title: 'Migration vers la nouvelle API de commandes', status: 'todo', category: cat('Tâche'), delivery: d1.id, start: 1, end: 10 },
  { title: 'Fuite mémoire sur le défilement', status: 'in_progress', category: cat('Bug'), start: -4, end: 5, assignees: [theo], progress: [[theo, 60]] },
  { title: 'Documenter l’API interne', status: 'backlog', category: cat('Tâche') },
];

const ticketIds: number[] = [];
for (const spec of specs) {
  const ticket = createTicket(ctx, actor(camille), project.id, {
    title: spec.title,
    description: spec.description ?? '',
    status: spec.status === 'done' ? 'in_progress' : spec.status,
    categoryId: spec.category,
    deliveryId: spec.delivery ?? null,
    startDate: spec.start !== undefined ? addDays(today, spec.start) : null,
    endDate: spec.end !== undefined ? addDays(today, spec.end) : null,
    assigneeIds: spec.assignees ?? [],
  });
  ticketIds.push(ticket.id);
  for (const userId of spec.done ?? []) {
    updatePart(ctx, actor(userId), ticket.id, userId, { done: true });
  }
  for (const [userId, progress] of spec.progress ?? []) {
    updatePart(ctx, actor(userId), ticket.id, userId, { progress });
  }
  if (spec.status === 'done' && !(spec.done && spec.done.length === (spec.assignees ?? []).length && spec.done.length > 0)) {
    // Ticket terminé sans parts déclarées : on clôture via les assignés.
    for (const userId of spec.assignees ?? []) {
      updatePart(ctx, actor(userId), ticket.id, userId, { done: true });
    }
  }
}

// Les tickets terminés ont été clôturés « il y a quelques jours » (pour un burn-down réaliste).
specs.forEach((spec, index) => {
  if (spec.status === 'done') {
    db.run('UPDATE tickets SET completed_at = ? WHERE id = ?', `${addDays(today, spec.end ?? -10)}T12:00:00.000Z`, ticketIds[index]!);
  }
});

// Une discussion avec réponses sur la liste des commandes.
const discussed = ticketIds[3]!;
const first = createComment(ctx, actor(camille), discussed, { body: 'On part sur une pagination infinie plutôt que des pages numérotées ?' });
const reply = createComment(ctx, actor(hugo), discussed, { body: 'Oui, avec un chargement de 20 commandes à la fois. Je prépare l’API.', parentId: first.id });
createComment(ctx, actor(theo), discussed, { body: 'Parfait, je branche l’interface dès que l’endpoint est dispo.', parentId: reply.id });
createComment(ctx, actor(ines), discussed, { body: 'Pensez à un état vide soigné quand il n’y a aucune commande 🙂' });
createComment(ctx, actor(theo), ticketIds[5]!, { body: 'Toujours bloqué : le certificat de production n’a pas été délivré.' });

console.log(`Projet de démonstration créé (${specs.length} tickets). Comptes : camille@demo.fr, hugo@demo.fr, ines@demo.fr, theo@demo.fr — mot de passe : demo1234`);
db.close();
process.exit(0);
