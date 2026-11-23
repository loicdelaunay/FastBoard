/** Textes ajoutés en 2.10 : actualisation depuis le disque, sélection multiple dans l'arbre. */
export const enV31: Record<string, string> = {
  'Actualisation impossible': 'Refresh failed',
  'Actualiser depuis le disque': 'Refresh from disk',
  'Actualiser depuis le disque ?': 'Refresh from disk?',
  'Désélectionner': 'Deselect',
  'Espace actualisé : {added} ajouté(s), {updated} mis à jour, {removed} à la corbeille.': 'Space refreshed: {added} added, {updated} updated, {removed} moved to the trash.',
  'Ils vont à la corbeille pendant 15 jours, avec le contenu des dossiers choisis.': 'They go to the trash for 15 days, with the contents of the chosen folders.',
  'Le dossier de l’espace sur le serveur est relu : les notes, images et dossiers ajoutés à la main entrent dans l’espace, les fichiers modifiés à côté sont relus (l’historique garde le texte précédent), et ceux qui ont disparu passent à la corbeille.': 'The space folder on the server is read again: notes, images and folders added by hand enter the space, files changed outside are read again (the history keeps the previous text), and those that disappeared go to the trash.',
  'L’espace est déjà à jour avec le disque.': 'The space is already up to date with the disk.',
  'Ouvrir dans des onglets': 'Open in tabs',
  'Supprimer la sélection': 'Delete selection',
  'Supprimer {n} éléments ?': 'Delete {n} items?',
  '{n} fichier ignoré (format non pris en charge ou nom refusé).|{n} fichiers ignorés (format non pris en charge ou nom refusé).': '{n} file skipped (unsupported format or rejected name).|{n} files skipped (unsupported format or rejected name).',
  '{n} élément sélectionné|{n} éléments sélectionnés': '{n} item selected|{n} items selected',

  // Journal des modifications
  'Documentation : « Actualiser depuis le disque » (réglages de l’espace) relit le dossier de l’espace sur le serveur : les notes, images et dossiers ajoutés à la main entrent dans l’espace, les fichiers modifiés à côté sont relus, et ceux qui ont disparu passent à la corbeille.':
    'Documentation: “Refresh from disk” (space settings) reads the space folder on the server again: notes, images and folders added by hand enter the space, files changed outside are read again, and those that disappeared go to the trash.',
  'Documentation : sélection multiple dans l’arbre des fichiers, comme dans un explorateur : Ctrl (Cmd) + clic, Maj + clic, Maj + flèches et Ctrl A ; la sélection se supprime (Suppr), se glisse vers un dossier ou s’ouvre dans des onglets.':
    'Documentation: multiple selection in the file tree, as in a file explorer: Ctrl (Cmd) + click, Shift + click, Shift + arrows and Ctrl A; the selection can be deleted (Delete), dragged to a folder or opened in tabs.',
  'Documentation : on ne peut plus avoir un fichier et un dossier choisis en même temps dans l’arbre.':
    'Documentation: a file and a folder can no longer be chosen at the same time in the tree.',
};
