/**
 * Version de l'application et journal des modifications affiché sous le nom de l'application.
 *
 * À chaque modification importante : incrémenter `APP_VERSION` (et `version` dans package.json, vérifié par un test),
 * puis ajouter une entrée en tête de `CHANGELOG`. Les textes sont en français (clés de traduction) : ajouter leur
 * traduction anglaise dans `src/i18n/en.c.ts`. Voir AGENTS.md.
 */

export const APP_VERSION = '1.1.0';

export type ChangeCategory = 'Nouveauté' | 'Amélioration' | 'Correction' | 'Sécurité';

export const CHANGE_CATEGORIES: Record<ChangeCategory, { icon: string; severity: 'success' | 'info' | 'warn' | 'danger' }> = {
  Nouveauté: { icon: 'pi pi-sparkles', severity: 'success' },
  Amélioration: { icon: 'pi pi-arrow-up-right', severity: 'info' },
  Correction: { icon: 'pi pi-wrench', severity: 'warn' },
  Sécurité: { icon: 'pi pi-shield', severity: 'danger' },
};

export interface ChangelogRelease {
  version: string;
  /** Date de publication, `YYYY-MM-DD`. */
  date: string;
  changes: Array<{ category: ChangeCategory; text: string }>;
}

export const CHANGELOG: ChangelogRelease[] = [
  {
    version: '1.1.0',
    date: '2026-10-20',
    changes: [
      { category: 'Nouveauté', text: 'Priorités de tickets, réglables par projet (nom, icône, couleur).' },
      { category: 'Nouveauté', text: 'Composants de tickets, configurables par projet.' },
      { category: 'Nouveauté', text: 'Sous-tâches dans les tickets, avec responsable et case à cocher.' },
      { category: 'Nouveauté', text: 'Dépendances entre tickets avec une raison (liste ou texte libre).' },
      { category: 'Nouveauté', text: 'Au survol d’une carte du Kanban, ses dépendances sont reliées et clignotent légèrement.' },
      { category: 'Nouveauté', text: 'Mentions « @ » de personnes et de tickets dans les descriptions et commentaires.' },
      { category: 'Nouveauté', text: 'Recherche globale (projets, tickets, utilisateurs) en haut de l’écran.' },
      { category: 'Nouveauté', text: "Page utilisateur avec le résumé de son activité." },
      { category: 'Nouveauté', text: "Indicateur d'inactivité discret des tickets, en points (automatisation du projet)." },
      { category: 'Nouveauté', text: 'Sauvegardes planifiées vers un dossier (ZIP, incrémentales, conservation façon Duplicati).' },
      { category: 'Nouveauté', text: 'Installation de FastBoard comme service démarré automatiquement.' },
      { category: 'Nouveauté', text: "Jetons d'API : nom d'affichage, réaffichage de la clé et prolongation." },
      { category: 'Amélioration', text: "Filtres par valeur dans les en-têtes des tableaux." },
      { category: 'Amélioration', text: "Choix de la version de l'analyseur dans une liste déroulante." },
      { category: 'Amélioration', text: "L'historique des tickets indique « via » le jeton d'API, comme l'activité." },
      { category: 'Correction', text: "Le filtre d'origine de l'activité distingue l'interface et l'API." },
    ],
  },
  {
    version: '1.0.0',
    date: '2026-10-17',
    changes: [
      { category: 'Nouveauté', text: 'Première version : Kanban, liste, Gantt, analyseur et activité en temps réel.' },
      { category: 'Nouveauté', text: "Rôles et permissions, jetons d'API et documentation Swagger." },
      { category: 'Nouveauté', text: 'Pièces jointes, supervision, export PDF et interface en français et en anglais.' },
    ],
  },
];
