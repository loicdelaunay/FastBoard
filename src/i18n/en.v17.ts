/** Anglais — textes ajoutés en 1.7 (analyseur, création filtrée, assistant IA sur un ticket). */
export const enV17: Record<string, string> = {
  'Analyseur : masquer les terminés dans « Non assigné »': 'Analyzer: hide done tickets in “Unassigned”',
  'Dans la charge par personne, les tickets terminés sans personne assignée ne sont pas comptés : « Non assigné » ne montre que le travail restant à attribuer.':
    'In the workload per person, done tickets without an assignee are not counted: “Unassigned” only shows work still to be assigned.',
  'Fermer l’assistant IA': 'Close the AI assistant',
  'Demander à l’assistant IA à propos de ce ticket': 'Ask the AI assistant about this ticket',
  'Prochaine version': 'Next release',
  'Version en cours': 'Current release',

  // Journal des modifications 1.7
  'L’assistant IA s’ouvre par-dessus un ticket, avec un bouton dans l’en-tête du ticket ; il connaît le ticket ouvert.': 'The AI assistant opens on top of a ticket, with a button in the ticket header; it knows the open ticket.',
  'Analyseur : raccourci vers la version en cours (ou la prochaine) à côté du choix de la livraison.': 'Analyzer: shortcut to the current (or next) release next to the release picker.',
  'Analyseur : la charge par personne détaille chaque colonne du Kanban, avec ses couleurs (aussi dans le rapport PDF).': 'Analyzer: the workload per person details every Kanban column, with its colors (also in the PDF report).',
  'Option du projet (activée par défaut) : les tickets terminés ne sont plus comptés dans « Non assigné » de la charge par personne.': 'Project option (on by default): done tickets are no longer counted in “Unassigned” in the workload per person.',
  'Un ticket créé depuis une vue filtrée reprend la catégorie, la livraison et les personnes filtrées.': 'A ticket created from a filtered view takes the filtered category, release and people.',
};
