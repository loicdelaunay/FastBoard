/** Textes ajoutés en 2.32.0 : post-it lisibles au zoom, note des fichiers en fenêtre, sélection des liens. */
export const enV56: Record<string, string> = {
  // Journal des modifications.
  'Tableaux blancs : le texte des post-it reste lisible en dézoomant (il grandit pour garder une taille lisible à l’écran, sans couper les mots), et ce qui ne tient plus se termine par « … » ; à 100 %, rien ne change.':
    'Whiteboards: sticky note text stays readable when zooming out (it grows to keep a readable size on screen, without splitting words), and whatever no longer fits ends with “…”; at 100%, nothing changes.',
  'Documentation : la note d’un fichier ou d’un dossier s’affiche dans une petite fenêtre au survol de sa ligne dans l’arbre (et des modèles), avec « Modifier la note » pour les éditeurs, au lieu de la bulle du navigateur.':
    'Documentation: the note on a file or folder appears in a small window when hovering its row in the tree (and the templates), with “Edit note” for editors, instead of the browser’s tooltip.',
  'Tableaux blancs : le cadre de sélection ne prend un lien que s’il l’englobe en entier, comme les autres éléments, au lieu de le prendre dès qu’il en touche un bout.':
    'Whiteboards: the selection box only picks a link when it encloses it entirely, like other elements, instead of picking it as soon as it touches part of it.',
};
