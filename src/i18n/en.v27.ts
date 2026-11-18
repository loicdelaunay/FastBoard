/** Textes ajoutés en 2.6 : thèmes détaillés et partagés, lecture des notes, connexion, tableaux blancs. */
export const enV27: Record<string, string> = {
  // Connexion
  'Mémoriser mon adresse sur ce navigateur': 'Remember my address on this browser',
  'Mémoriser mon identifiant sur ce navigateur': 'Remember my username on this browser',

  // Lecture des notes
  'Lecture des notes': 'Reading notes',
  'Centré sur l’écran': 'Centred on the screen',
  'Le texte se place au milieu de l’écran, même avec l’arbre et le sommaire ouverts : on lit sans tourner la tête.':
    'The text sits in the middle of the screen, even with the tree and the outline open: you read without turning your head.',
  'Centré dans sa colonne': 'Centred in its column',
  'Le texte se centre dans l’espace qui lui reste, à droite de l’arbre et du sommaire.': 'The text is centred in the space left to it, to the right of the tree and the outline.',
  'Toute la largeur': 'Full width',
  'Sans marges sur les côtés : le texte prend toute la largeur disponible.': 'No side margins: the text takes all the available width.',
  'Réglage non enregistré': 'Setting not saved',
  'Thème, thèmes personnalisés, polices et lecture sont enregistrés sur votre compte et vous suivent sur tous vos appareils.':
    'Theme, custom themes, fonts and reading are saved on your account and follow you on all your devices.',

  // Polices
  'Texte des notes': 'Note text',
  'Une note de documentation, lue au calme et sans fatigue.': 'A documentation note, read calmly and without strain.',
  'Taille du texte des notes': 'Note text size',
  'Taille propre au texte des notes': 'Own size for the note text',
  'Comme le texte de l’interface': 'Like the interface text',

  // Couleurs d'un thème
  'Fond de page': 'Page background',
  'Panneaux et cartes': 'Panels and cards',
  'Panneaux secondaires': 'Secondary panels',
  Bordures: 'Borders',
  'Texte secondaire': 'Secondary text',
  'Titre 1': 'Heading 1',
  'Titre 2': 'Heading 2',
  'Titre 3': 'Heading 3',
  'Titre 4': 'Heading 4',
  'Titres 4 à 6': 'Headings 4 to 6',
  Gras: 'Bold',
  Italique: 'Italic',
  Liens: 'Links',
  'Code dans le texte': 'Inline code',
  'Fond du code dans le texte': 'Inline code background',
  'Texte des blocs de code': 'Code block text',
  'Fond des blocs de code': 'Code block background',
  'Texte des citations': 'Quote text',
  'Barre des citations': 'Quote bar',
  'Fond des citations': 'Quote background',
  Surlignage: 'Highlight',
  'En-tête des tableaux': 'Table header',
  'Bordures des tableaux': 'Table borders',
  'Lignes horizontales': 'Horizontal rules',
  'Puces et numéros': 'Bullets and numbers',
  Étiquettes: 'Tags',

  // Éditeur de thème
  Bases: 'Basics',
  Interface: 'Interface',
  'Notes (Markdown)': 'Notes (Markdown)',
  'Sans réglage, une couleur suit les bases du thème.': 'Without a setting, a colour follows the theme basics.',
  'Couleurs du texte des notes, des descriptions et des commentaires. Sans réglage, une couleur suit l’interface.':
    'Colours of the text of notes, descriptions and comments. Without a setting, a colour follows the interface.',
  'Tout rétablir': 'Reset all',
  'Couleur par défaut': 'Default colour',
  'Polices propres au thème : elles remplacent celles de vos réglages tant que le thème est utilisé.': 'Fonts of the theme: they replace those of your settings while the theme is in use.',
  'Celle de mes réglages': 'The one from my settings',
  'Du texte avec du **gras**, de l’*italique*, un [lien](https://example.com), du `code` et ==un surlignage==. #étiquette':
    'Some text with **bold**, *italics*, a [link](https://example.com), `code` and ==a highlight==. #tag',
  'Une citation, avec sa barre et son fond.': 'A quote, with its bar and background.',
  'Une puce': 'A bullet',
  'Un numéro': 'A number',
  Colonne: 'Column',
  Valeur: 'Value',

  // Mes thèmes, import, export, bibliothèque
  'Importer un thème': 'Import a theme',
  'Exporter (fichier à envoyer)': 'Export (file to send)',
  'Partager avec tout le site': 'Share with the whole site',
  'Thèmes partagés du site': 'Themes shared on the site',
  'Aucun thème partagé pour l’instant : survolez un de vos thèmes, puis « Partager avec tout le site ».': 'No shared theme yet: hover one of your themes, then “Share with the whole site”.',
  'Ajouter à mes thèmes': 'Add to my themes',
  'Retirer de la bibliothèque': 'Remove from the library',
  'Retirer « {name} » des thèmes partagés ? Ceux qui l’ont déjà ajouté le gardent.': 'Remove “{name}” from the shared themes? Those who already added it keep it.',
  'Trop de thèmes': 'Too many themes',
  'Supprimez un de vos thèmes avant d’en ajouter un autre.': 'Delete one of your themes before adding another.',
  'Thème ajouté': 'Theme added',
  '« {name} » est dans vos thèmes, et utilisé.': '“{name}” is in your themes, and in use.',
  'Ce n’est pas un thème exporté par FastBoard (texte JSON attendu).': 'This is not a theme exported by FastBoard (JSON text expected).',
  'Thème invalide : il manque au moins sa couleur principale.': 'Invalid theme: at least its main colour is missing.',
  'Thème partagé': 'Theme shared',
  'Toutes les personnes du site peuvent maintenant ajouter « {name} » à leurs thèmes.': 'Everyone on the site can now add “{name}” to their themes.',
  'Thème non partagé': 'Theme not shared',
  'Choisissez le fichier .fastboard-theme.json qu’on vous a envoyé, ou collez son contenu.': 'Choose the .fastboard-theme.json file you were sent, or paste its content.',
  'Choisir un fichier…': 'Choose a file…',
  'Contenu du thème (JSON)': 'Theme content (JSON)',

  // Journal des modifications
  "Notifications : un agent qui crée ou commente des tickets avec votre jeton d’API ne vous y abonne plus ; les personnes assignées ou mentionnées les suivent toujours.":
    "Notifications: an agent that creates or comments on tickets with your API token no longer subscribes you to them; assigned or mentioned people still follow them.",
  "Notifications : le niveau « Mentions seulement » devient « Mentions et assignations » et prévient aussi quand on vous assigne un ticket.":
    "Notifications: the “Mentions only” level becomes “Mentions and assignments” and also notifies you when you are assigned a ticket.",
  "Tableaux blancs : grouper et dégrouper des éléments (Ctrl G, Ctrl Maj G ou clic droit) ; un clic prend tout le groupe, un double-clic y entre pour choisir un seul élément.":
    "Whiteboards: group and ungroup elements (Ctrl G, Ctrl Shift G or right-click); a click takes the whole group, a double-click enters it to pick a single element.",
  "Notifications : chacun choisit, projet par projet, ce qui le notifie (tout, sa participation par défaut, ses mentions seulement, ou rien), depuis la cloche de l’en-tête du projet ou Mon compte → Notifications.":
    "Notifications: everyone chooses, project by project, what notifies them (everything, their participation by default, their mentions only, or nothing), from the bell in the project header or My account → Notifications.",
  "Notifications du navigateur : une notification système prévient quand FastBoard n’est pas au premier plan, et un clic ouvre le ticket ou la note.":
    "Browser notifications: a system notification warns you when FastBoard is not in the foreground, and a click opens the ticket or the note.",
  "Notifications : une personne mentionnée dans un ticket le suit, et le bouton « Suivre » se met à jour en direct.":
    "Notifications: a person mentioned in a ticket follows it, and the “Follow” button updates live.",
  "Thèmes personnalisés : chaque couleur se règle une à une, celles de l’interface comme celles du rendu des notes (titres, liens, code, citations, tableaux…), avec un aperçu en direct, et un thème peut avoir ses propres polices.":
    "Custom themes: each colour can be set one by one, those of the interface as well as those of the note rendering (headings, links, code, quotes, tables…), with a live preview, and a theme can have its own fonts.",
  "Thèmes partagés : un thème s’exporte en fichier et s’importe, ou se publie dans la bibliothèque du site, où chacun l’ajoute à ses thèmes d’un clic.":
    "Shared themes: a theme can be exported to a file and imported, or published to the site library, where anyone adds it to their themes in one click.",
  "Documentation : le texte des notes se centre sur l’écran pour lire sans tourner la tête ; dans Apparence, on peut aussi le centrer dans sa colonne ou lui laisser toute la largeur, et choisir sa police et sa taille.":
    "Documentation: note text is centred on the screen so you can read without turning your head; in Appearance you can also centre it in its column or give it the full width, and choose its font and size.",
  "Connexion : la session ne s’arrête plus 14 jours après la connexion mais après 30 jours sans utilisation, et la page de connexion mémorise l’adresse e-mail.":
    "Sign-in: the session no longer ends 14 days after signing in but after 30 days without use, and the sign-in page remembers the email address.",
  "Tableaux blancs : clic droit (ou « ⋯ ») sur les tableaux de la vue d’ensemble d’un espace pour les ouvrir, renommer, dupliquer, partager ou supprimer.":
    "Whiteboards: right-click (or “⋯”) the boards of a space overview to open, rename, duplicate, share or delete them.",
  "Commentaires : l’avatar d’une personne mentionnée avec @ n’est plus écrasé.":
    "Comments: the avatar of a person mentioned with @ is no longer squashed.",
};
