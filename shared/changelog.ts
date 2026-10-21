/**
 * Version de l'application et journal des modifications affiché sous le nom de l'application.
 *
 * À chaque modification importante : incrémenter `APP_VERSION` (et `version` dans package.json, vérifié par un test),
 * puis ajouter une entrée en tête de `CHANGELOG`. Les textes sont en français (clés de traduction) : ajouter leur
 * traduction anglaise dans `src/i18n/en.c.ts`. Voir AGENTS.md.
 */

export const APP_VERSION = '1.3.0';

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
    version: '1.3.0',
    date: '2026-10-21',
    changes: [
      { category: 'Nouveauté', text: 'Assistant IA dans un panneau latéral : il connaît le projet ou le ticket ouvert, cherche partout et peut modifier les tickets si vous l’autorisez.' },
      { category: 'Nouveauté', text: 'Administration : onglet IA pour brancher un fournisseur compatible OpenAI v1 (URL, clé), détecter ses modèles, choisir ceux proposés et le modèle par défaut.' },
      { category: 'Nouveauté', text: 'Capacités par modèle : vision (images jointes), taille du contexte et niveaux de réflexion, choisis dans les réglages du panneau.' },
      { category: 'Sécurité', text: 'Nouvelles permissions IA, globales et par projet ; l’assistant n’a jamais plus de droits que la personne.' },
      { category: 'Correction', text: 'Les onglets Personnalisation, Maintenance, Sauvegardes et Installation ont la même mise en page que les autres.' },
    ],
  },
  {
    version: '1.2.0',
    date: '2026-10-21',
    changes: [
      { category: 'Nouveauté', text: 'Description des tickets en Markdown, avec barre d’outils, formules mathématiques, diagrammes Mermaid et plein écran.' },
      { category: 'Nouveauté', text: 'Notifications : suivre un ticket, être prévenu quand on est assigné ou mentionné avec @.' },
      { category: 'Nouveauté', text: 'Menu du clic droit enrichi : titre, assignés, dates, priorité, livraison, colonne ou autre projet.' },
      { category: 'Nouveauté', text: 'Pièces jointes : liens web et liens vers un fichier ou un dossier du poste.' },
      { category: 'Nouveauté', text: 'Administration : nom et logo de l’application, message de maintenance à plusieurs niveaux.' },
      { category: 'Nouveauté', text: 'Export d’un projet en CSV ou en JSON depuis le clic droit sur la page des projets.' },
      { category: 'Nouveauté', text: 'Automatisations : colonnes comptées à 100 %, tri automatique par colonne, pastille d’échéance des livraisons.' },
      { category: 'Amélioration', text: 'Page des projets : avancement de la livraison en cours comparé au temps écoulé, lien vers la documentation de l’API.' },
      { category: 'Amélioration', text: 'Survoler « en ligne » affiche la liste de toutes les personnes connectées au projet.' },
      { category: 'Correction', text: 'Le Kanban défile dans une colonne pendant le glisser-déposer d’un ticket.' },
    ],
  },
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
