/** Textes ajoutés en 2.7 : rappel d'avancement, recherche dans les notes, onglets web, coloration du code. */
export const enV28: Record<string, string> = {
  // Rappel d'avancement
  'Rappeler de mettre à jour l’avancement': 'Remind people to update their progress',
  'Pendant une livraison en cours, chaque personne qui a des tickets « En cours » voit une balise l’invitant à mettre à jour son avancement : au moins le pourcentage de sa ligne, ou un commentaire de progression. Les cartes indiquent qui ne l’a pas fait.':
    'During an ongoing delivery, everyone with tickets “In progress” sees a tag inviting them to update their progress: at least the percentage of their line, or a progress comment. Cards show who has not done it.',
  'Rappeler après': 'Remind after',
  'Jours sans mise à jour de l’avancement': 'Days without a progress update',
  'jours sans mise à jour de l’avancement': 'days without a progress update',
  'Pensez à mettre à jour votre avancement': 'Remember to update your progress',
  '{n} avancement à mettre à jour|{n} avancements à mettre à jour': '{n} progress update due|{n} progress updates due',
  'Ces tickets sont en cours dans une livraison en cours. Mettez à jour au moins le pourcentage de votre ligne, ou laissez un commentaire de progression.':
    'These tickets are in progress in an ongoing delivery. Update at least the percentage of your line, or leave a progress comment.',
  'dernière mise à jour {when}': 'last update {when}',
  'jamais mis à jour': 'never updated',
  'Livraison en cours : pensez à mettre à jour votre avancement (pourcentage de votre ligne ou commentaire de progression).':
    'Ongoing delivery: remember to update your progress (percentage of your line or a progress comment).',
  'Avancement à mettre à jour (pourcentage ou commentaire) : {names}': 'Progress to update (percentage or comment): {names}',
  'Ce ticket est en cours dans une livraison en cours : mettez à jour au moins le pourcentage de votre ligne, ou laissez un commentaire de progression.':
    'This ticket is in progress in an ongoing delivery: update at least the percentage of your line, or leave a progress comment.',

  // Recherche dans une note (Ctrl F)
  'Rechercher dans la note': 'Find in note',
  'Expression invalide': 'Invalid expression',
  '{n} résultats': '{n} results',
  '{current} sur {total}': '{current} of {total}',
  'Masquer le remplacement': 'Hide replace',
  'Remplacer (Ctrl H)': 'Replace (Ctrl H)',
  'Respecter la casse (Alt C)': 'Match case (Alt C)',
  'Respecter la casse': 'Match case',
  'Mot entier (Alt W)': 'Whole word (Alt W)',
  'Mot entier': 'Whole word',
  'Expression régulière (Alt R)': 'Regular expression (Alt R)',
  'Expression régulière': 'Regular expression',
  'Précédent (Maj Entrée)': 'Previous (Shift Enter)',
  'Résultat précédent': 'Previous result',
  'Suivant (Entrée)': 'Next (Enter)',
  'Résultat suivant': 'Next result',
  'Fermer (Échap)': 'Close (Esc)',
  'Fermer la recherche': 'Close find',
  'Remplacer par': 'Replace with',
  'Remplacer (Entrée)': 'Replace (Enter)',
  'Tout remplacer (Ctrl Entrée)': 'Replace all (Ctrl Enter)',

  // Pages web dans un onglet
  Recharger: 'Reload',
  'Ouvrir dans le navigateur': 'Open in browser',
  'Page vide ? {host} refuse peut-être d’être affiché ici : ouvrez-le dans le navigateur (ou Ctrl clic sur le lien).':
    'Blank page? {host} may refuse to be shown here: open it in the browser (or Ctrl click the link).',

  // Couleurs des surlignages (autocomplétion après « == »)
  Marron: 'Brown',
  Blanc: 'White',

  // Journal des modifications
  'Projets : rappel d’avancement (Réglages → Automatisation) : pendant une livraison en cours, chaque personne qui a des tickets « En cours » est invitée à mettre à jour son avancement, en pourcentage ou par un commentaire ; une balise dans l’en-tête du projet liste ses tickets, et les cartes indiquent qui ne l’a pas fait.':
    'Projects: progress reminder (Settings → Automation): during an ongoing delivery, everyone with tickets “In progress” is invited to update their progress, as a percentage or with a comment; a tag in the project header lists their tickets, and cards show who has not done it.',
  'Documentation : nouvelle recherche dans la note (Ctrl F), à la manière de VS Code : compteur de résultats, casse, mot entier, expressions régulières, et remplacement en écriture (Ctrl H).':
    'Documentation: new find in note (Ctrl F), VS Code style: result counter, match case, whole word, regular expressions, and replace when writing (Ctrl H).',
  'Documentation : un lien web s’ouvre dans un onglet de la documentation ; Ctrl clic l’ouvre dans une nouvelle page du navigateur, et Ctrl clic sur une note l’ouvre dans un nouvel onglet.':
    'Documentation: a web link opens in a documentation tab; Ctrl click opens it in a new browser page, and Ctrl click on a note opens it in a new tab.',
  'Documentation : coloration syntaxique des blocs de code selon leur langage (```python, ```sql…), en lecture comme en écriture.':
    'Documentation: syntax highlighting of code blocks by language (```python, ```sql…), when reading as well as writing.',
  'Documentation : après « == », l’autocomplétion propose les billes de couleur des surlignages (==🟢 Validé==).':
    'Documentation: after “==”, autocompletion suggests the coloured dots of highlights (==🟢 Done==).',
  'Documentation : l’arbre des fichiers garde en haut les dossiers ouverts pendant le défilement, comme dans VS Code, et les fichiers s’alignent à gauche, sous l’icône de leur dossier.':
    'Documentation: the file tree keeps open folders pinned at the top while scrolling, as in VS Code, and files are aligned to the left, under their folder’s icon.',
  'Documentation : passer de Lecture à Lecture et écriture ou à Écriture garde la même position dans la note.':
    'Documentation: switching between Read, Read and write and Write keeps the same position in the note.',
  'Thèmes : avec les thèmes du site, le code en ligne, les citations, les puces et les en-têtes de tableau prennent la couleur du thème.':
    'Themes: with the site’s themes, inline code, quotes, bullets and table headers take the theme’s colour.',
  'Documentation : les formules $…$ et les balises HTML en ligne (<sup>, <sub>, <kbd>, <mark>…) s’affichent aussi en « Lecture et écriture », même avec des _ ou des * dans la formule.':
    'Documentation: $…$ formulas and inline HTML tags (<sup>, <sub>, <kbd>, <mark>…) are also rendered in “Read and write”, even with _ or * in the formula.',
  'Documentation : les titres numérotés (« 1. Disponibilité ») gardent leur numéro dans le Sommaire, et les liens d’une table des matières (#1-disponibilite, {#id}, <a id>) mènent au bon titre.':
    'Documentation: numbered headings (“1. Availability”) keep their number in the Outline, and table of contents links (#1-availability, {#id}, <a id>) lead to the right heading.',
};
