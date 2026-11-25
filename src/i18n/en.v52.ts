/** Textes ajoutés en 2.28.0 : déplacer vers un autre espace, filtres des mentions « @ » et de Ctrl + K, image de l'espace, langage des blocs de code. */
export const enV52: Record<string, string> = {
  // Journal des modifications 2.28.0
  'Documentation et tableaux blancs : clic droit sur un ou plusieurs éléments, « Déplacer vers… » les envoie dans un autre espace, à sa racine ou dans un de ses dossiers ; ils gardent leur historique, leurs commentaires et leur partage.':
    'Documentation and whiteboards: right-click one or more items, “Move to…” sends them to another space, at its root or into one of its folders; they keep their history, comments and sharing.',
  'Un élément déplacé quitte aussitôt l’ancien espace pour qui n’a pas accès au nouveau, y compris pour l’assistant IA et la recherche sémantique ; les images d’un tableau déplacé sont copiées dans son nouvel espace.':
    'A moved item leaves the old space at once for anyone without access to the new one, including for the AI assistant and semantic search; the images of a moved board are copied into its new space.',
  'Tableaux blancs : Ctrl + clic et Maj + clic sélectionnent plusieurs éléments dans l’arbre.':
    'Whiteboards: Ctrl + click and Shift + click select several items in the tree.',
  'Mentions « @ » : des pastilles filtrent par type (personnes, tickets, documents, tableaux blancs, versions), chacun avec son icône et sa couleur ; « Voir tout… » ouvre une fenêtre pour trouver vite l’élément quand la liste ne suffit pas.':
    'Mentions “@”: pills filter by type (people, tickets, documents, whiteboards, versions), each with its icon and colour; “See all…” opens a window to quickly find the item when the list is not enough.',
  'Recherche Ctrl + K : les mêmes pastilles par catégorie (Tab pour passer de l’une à l’autre), et les tableaux blancs y sont trouvés.':
    'Ctrl + K search: the same category pills (Tab to switch from one to the next), and whiteboards are found there.',
  'Documentation : « Image » propose de réutiliser une image déjà rangée dans l’espace (recherche, vignettes) ou d’en importer une depuis l’ordinateur ; l’image s’insère sur sa propre ligne.':
    'Documentation: “Image” offers to reuse an image already in the space (search, thumbnails) or to import one from the computer; the image is inserted on its own line.',
  'Blocs de code : une pastille en haut à droite affiche leur langage ; un clic permet d’en choisir un autre.':
    'Code blocks: a pill at the top right shows their language; a click lets you choose another one.',
  'Documentation : l’adresse suit l’endroit lu (`#etape-2+12` : le titre au-dessus et le décalage) ; en changeant de note ou d’onglet puis en revenant, avec Précédent ou en ouvrant un lien partagé, la note s’ouvre au même endroit.':
    'Documentation: the address follows the place being read (`#step-2+12`: the heading above and the offset); switching notes or tabs and coming back, using Back or opening a shared link, the note opens at the same place.',

  // Déplacer vers un autre espace
  'Déplacer vers…': 'Move to…',
  'Déplacer « {name} » vers…': 'Move “{name}” to…',
  'Déplacer {n} éléments vers…': 'Move {n} items to…',
  'Espace d’arrivée': 'Destination space',
  'Choisir un espace': 'Choose a space',
  'Aucun autre espace où vous êtes éditeur.': 'No other space where you are an editor.',
  'Rechercher un espace…': 'Search a space…',
  'Rechercher un dossier…': 'Search a folder…',
  'Racine de l’espace': 'Space root',
  'Aucun dossier : tout ira à la racine.': 'No folder: everything will go to the root.',
  'Un dossier part avec tout son contenu.': 'A folder takes all its content along.',
  'Chaque élément garde son historique ; un nom déjà pris devient « Nom (2) ». Les personnes sans accès à l’espace d’arrivée ne le verront plus.':
    'Each item keeps its history; a name already taken becomes “Name (2)”. People without access to the destination space will no longer see it.',
  'Déplacer': 'Move',
  'Déplacé vers « {name} »': 'Moved to “{name}”',
  '{n} éléments déplacés vers « {name} »': '{n} items moved to “{name}”',
  'Cette note vient d’être déplacée dans un autre espace.': 'This note has just been moved to another space.',
  'Ce tableau vient d’être déplacé dans un autre espace.': 'This board has just been moved to another space.',

  // Mentions « @ »
  Tout: 'All',
  Personnes: 'People',
  Tickets: 'Tickets',
  Documents: 'Documents',
  Versions: 'Versions',
  'Type d’élément': 'Item type',
  'pour changer de catégorie': 'to change category',
  'Voir tout…': 'See all…',
  'Chercher parmi tous les éléments': 'Search among all items',
  'Rien ne correspond.': 'Nothing matches.',
  'Rien ne correspond : revenir à « Tout »': 'Nothing matches: back to “All”',
  'Tapez pour chercher.': 'Type to search.',
  'Rechercher une personne, un ticket, une note…': 'Search a person, a ticket, a note…',
  'Résultats': 'Results',
  'D’autres éléments correspondent : précisez la recherche.': 'Other items match: refine the search.',

  // Langage d'un bloc de code
  Texte: 'Text',
  'Texte brut': 'Plain text',
  'Rechercher un langage…': 'Search a language…',
  'Langage du bloc de code': 'Code block language',
  Langages: 'Languages',
  'Aucun langage ne correspond.': 'No language matches.',
  'Ce bloc de code a changé entre-temps.': 'This code block has changed in the meantime.',

  // Image de l'espace
  'Insérer une image': 'Insert an image',
  'Rechercher une image de l’espace…': 'Search an image of the space…',
  'Rechercher une image de l’espace': 'Search an image of the space',
  'Importer depuis l’ordinateur': 'Import from the computer',
  '{n} image trouvée|{n} images trouvées': '{n} image found|{n} images found',
  '{n} image dans l’espace|{n} images dans l’espace': '{n} image in the space|{n} images in the space',
  'Précisez la recherche pour voir les autres.': 'Refine the search to see the others.',
  'Images de l’espace': 'Images of the space',
  'Aucune image ne correspond.': 'No image matches.',
  'Aucune image dans l’espace pour l’instant.': 'No image in the space yet.',
};
