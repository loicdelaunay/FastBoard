/** Textes ajoutés en 2.1 : sommaire, comparateur, assistant sur la documentation. */
export const enV22: Record<string, string> = {
  // Sommaire
  Sommaire: 'Outline',
  'Masquer le sommaire': 'Hide the outline',
  'Les titres de la note apparaîtront ici.': 'The headings of the note will appear here.',

  // Comparateur
  'Bloc {n} à choisir': 'Block {n} to decide',
  Résultat: 'Result',
  'À choisir': 'To decide',
  'Changé dans A': 'Changed in A',
  'Changé dans B': 'Changed in B',
  'Bloc précédent': 'Previous block',
  'Bloc {n} sur {total}': 'Block {n} of {total}',
  'Bloc suivant': 'Next block',
  'Ajouté dans B': 'Added in B',
  'Retiré dans B': 'Removed in B',
  Modifié: 'Changed',
  '{n} bloc à choisir|{n} blocs à choisir': '{n} block to decide|{n} blocks to decide',
  'Prendre tous les blocs de A': 'Take every block from A',
  'Prendre tous les blocs de B': 'Take every block from B',
  'Tout A': 'All of A',
  'Tout B': 'All of B',
  Réinitialiser: 'Reset',
  'Aucune différence entre ces deux versions.': 'No difference between these two versions.',
  Comparaison: 'Comparison',
  '{n} ligne identique|{n} lignes identiques': '{n} identical line|{n} identical lines',
  'Garder le bloc {n} de A': 'Keep block {n} from A',
  'Garder le bloc {n} de B': 'Keep block {n} from B',
  'Garder A': 'Keep A',
  'Garder B': 'Keep B',
  'Bloc {n}': 'Block {n}',
  modifiable: 'editable',

  // Import
  'Importer sur {name}': 'Import over {name}',
  'Importer dans {name}': 'Import into {name}',
  'Importer un .md ou un ZIP': 'Import a .md or a ZIP',
  'Importer un .md ou un ZIP ici': 'Import a .md or a ZIP here',
  'Importer un .md': 'Import a .md',
  'Exporter en .md': 'Export as .md',
  'Exporter l’image': 'Export the image',
  'Remplacer l’image': 'Replace the image',
  'Ce fichier n’existe pas encore ici.': 'This file does not exist here yet.',
  'Seul l’import a changé depuis l’export.': 'Only the import has changed since the export.',
  'Les deux versions ont changé, sans se gêner : les blocs sont déjà choisis.': 'Both versions have changed without getting in each other’s way: the blocks are already chosen.',
  'Choisissez ce que vous gardez de chaque bloc.': 'Choose what you keep from each block.',
  'Ce fichier a été exporté, mais n’est plus dans l’import.': 'This file was exported, but is no longer in the import.',
  'L’import n’apporte rien de neuf : seul le serveur a changé depuis l’export.': 'The import brings nothing new: only the server has changed since the export.',
  'Résultat de la comparaison': 'Result of the comparison',
  'Comparaison impossible': 'Comparison failed',
  'Fichier illisible': 'Unreadable file',
  'Choisissez la version à comparer à ce fichier. Vous choisirez bloc par bloc ce que vous gardez avant que quoi que ce soit ne soit écrit.':
    'Choose the version to compare with this file. You will choose what to keep block by block before anything is written.',
  'Choisissez un fichier .md, une image, un export de cet espace ou un coffre Obsidian zippé. Ce qui existe déjà se compare bloc par bloc avant que quoi que ce soit ne soit écrit.':
    'Choose a .md file, an image, an export of this space or a zipped Obsidian vault. What already exists is compared block by block before anything is written.',
  'Choisir un fichier ou un ZIP': 'Choose a file or a ZIP',
  'Fichiers de l’import': 'Files of the import',
  'Une image ne se compare pas : choisissez la version à garder.': 'Images cannot be compared: choose the version to keep.',
  'Sur le serveur': 'On the server',
  'Dans l’import': 'In the import',
  '{n} fichier avec des blocs à choisir|{n} fichiers avec des blocs à choisir': '{n} file with blocks to decide|{n} files with blocks to decide',

  // Historique
  'Comparer au texte actuel': 'Compare with the current text',
  'Version du {date}': 'Version of {date}',
  'Enregistrer le résultat ?': 'Save the result?',
  'Enregistrer le résultat': 'Save the result',
  'Le texte actuel est remplacé par le résultat pour tout le monde. Il reste dans l’historique.': 'The current text is replaced by the result for everyone. It stays in the history.',
  'Affichage de la version': 'Version display',
  'Le texte a changé depuis l’ouverture de la comparaison.': 'The text has changed since the comparison was opened.',
  'Comparer de nouveau': 'Compare again',
  'Texte actuel': 'Current text',

  // Assistant
  'Le passage a changé depuis : modifiez la note à la main.': 'The passage has changed since: edit the note by hand.',
  'Texte de la note': 'Text of the note',
  Note: 'Note',
  'Espace de documentation': 'Documentation space',
  'Note de la documentation': 'Documentation note',
  'Résume cette note': 'Summarise this note',
  'Corrige les fautes de cette note': 'Fix the mistakes in this note',
  'Que manque-t-il à cette note ?': 'What is missing from this note?',
  'Quelles autres notes parlent de ce sujet ?': 'Which other notes cover this topic?',
  'De quoi parle cet espace de documentation ?': 'What is this documentation space about?',
  'Quelles notes sont à compléter ?': 'Which notes need completing?',
  'Rédige une note de synthèse de cet espace': 'Write a summary note for this space',
  'Je connais la note ouverte et je peux chercher dans toute votre documentation.': 'I know the open note and can search all your documentation.',
  'Je connais cet espace et je peux chercher dans toute votre documentation.': 'I know this space and can search all your documentation.',
  'Posez une question sur cette documentation…': 'Ask a question about this documentation…',

  // Avancement
  'Supprimer cette ligne ?': 'Delete this line?',
  '« {name} » disparaît de l’avancement du ticket.': '“{name}” is removed from the progress of the ticket.',
  'Modifier la ligne': 'Edit the line',

  // Journal des modifications
  'Documentation : un sommaire à gauche de la note, en lecture et en lecture et écriture, reprend ses titres et sous-titres et y amène d’un clic.':
    'Documentation: an outline to the left of the note, in Read and Read & write modes, lists its headings and subheadings and takes you there in one click.',
  'Documentation : à l’import d’un fichier ou d’un ZIP, un comparateur montre les deux versions côte à côte, avec ce qui est ajouté, retiré ou changé. Vous choisissez bloc par bloc, et le résultat reste modifiable avant d’importer.':
    'Documentation: when importing a file or a ZIP, a comparison shows both versions side by side, with what was added, removed or changed. You choose block by block, and the result stays editable before importing.',
  'Documentation : le même comparateur dans l’historique d’une note, pour ne reprendre que certains blocs d’une ancienne version.':
    'Documentation: the same comparison in the history of a note, to bring back only some blocks of an older version.',
  'Assistant IA : il connaît la note ouverte, cherche et lit dans la documentation, et peut créer ou modifier des notes avec vos droits, en vous montrant chaque changement.':
    'AI assistant: it knows the open note, searches and reads the documentation, and can create or edit notes with your rights, showing you each change.',
  'Documentation : importer ou exporter un .md se fait au clic droit dans l’arbre, y compris pour déposer un nouveau fichier dans un dossier.':
    'Documentation: importing or exporting a .md is done with a right-click in the tree, including to drop a new file into a folder.',
  'Avancement : des lignes bien plus compactes, sur une seule ligne quand le texte le permet. Le crayon, la poignée et la suppression apparaissent au survol.':
    'Progress: much more compact lines, on a single line when the text allows it. The pencil, the handle and the delete button appear on hover.',
  'Avancement : une ligne est terminée quand sa barre atteint 100 %, sans case à cocher. La supprimer demande une confirmation.':
    'Progress: a line is finished when its bar reaches 100%, with no checkbox. Deleting one now asks for confirmation.',
  'Documentation : un fichier enregistré sous Windows n’apparaît plus comme entièrement modifié à l’import.':
    'Documentation: a file saved on Windows no longer appears as entirely changed on import.',
  'Documentation : ce qui venait d’être tapé reste dans l’historique quand la note est remplacée par un import ou une restauration.':
    'Documentation: what was just typed stays in the history when the note is replaced by an import or a restore.',
};
