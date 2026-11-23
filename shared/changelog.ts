/**
 * Version de l'application et journal des modifications affiché sous le nom de l'application.
 *
 * À chaque modification importante : incrémenter `APP_VERSION` (et `version` dans package.json, vérifié par un test),
 * puis ajouter une entrée en tête de `CHANGELOG`. Les textes sont en français (clés de traduction) : ajouter leur
 * traduction anglaise dans `src/i18n/en.c.ts`. Voir AGENTS.md.
 */

export const APP_VERSION = '2.14.0';

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
    version: '2.14.0',
    date: '2026-11-23',
    changes: [
      { category: 'Nouveauté', text: 'Tableaux blancs : les outils Forme et Composant de maquette ouvrent une palette en colonne où chaque élément se voit tel qu’il sera posé. Une recherche en tête filtre le bloc ouvert et propose, en petit, ce qui correspond ailleurs (autres éléments, icônes).' },
      { category: 'Nouveauté', text: 'Tableaux blancs : dans le choix d’une icône, on règle son style (contour, teinté ou plein) et sa couleur avant de la poser ; le style se change aussi dans la barre de mise en forme.' },
      { category: 'Correction', text: 'Documentation : un tableau blanc cité dans une note montre ses images et ses icônes ajoutées, au lieu d’un cadre avec leur nom.' },
      { category: 'Correction', text: 'Tableaux blancs : les onglets de l’ajout rapide et du menu des icônes ne sont plus écrasés.' },
    ],
  },
  {
    version: '2.13.0',
    date: '2026-11-23',
    changes: [
      { category: 'Nouveauté', text: 'Tableaux blancs : mode « Historique », à côté d’Annuler, comme la frise de Whimsical. On parcourt les versions du tableau (curseur, flèches ou lecture automatique), il s’affiche tel qu’il était et ce que chaque version ajoute ou modifie est entouré.' },
      { category: 'Nouveauté', text: 'Tableaux blancs : depuis l’historique, une version se restaure ou se copie dans un nouveau tableau, après confirmation. L’état d’avant une restauration reste dans l’historique.' },
      { category: 'Amélioration', text: 'Les fenêtres de confirmation gardent une largeur lisible, même avec un long message.' },
    ],
  },
  {
    version: '2.12.1',
    date: '2026-11-23',
    changes: [
      { category: 'Amélioration', text: 'Tableaux blancs : la fenêtre d’export montre à droite l’aperçu de ce qui sera enregistré (tout le tableau ou la sélection, avec ou sans fond) et la taille du fichier.' },
      { category: 'Amélioration', text: 'Tableaux blancs : le titre d’une section garde une taille lisible quel que soit le zoom.' },
      { category: 'Correction', text: 'Tableaux blancs : le point bleu d’un côté d’où part déjà un lien ne disparaît plus quand on s’en approche, on peut en tirer un autre lien.' },
      { category: 'Correction', text: 'Tableaux blancs : la barre de mise en forme se place plus haut et ne recouvre plus le point bleu du haut de l’élément choisi.' },
    ],
  },
  {
    version: '2.12.0',
    date: '2026-11-23',
    changes: [
      { category: 'Nouveauté', text: 'Tableaux blancs : « Exporter… » (menu ⋯ et clic droit) enregistre tout le tableau ou la sélection en PNG, WebP, SVG ou PDF, à l’échelle choisie et avec ou sans fond, ou copie l’image, comme dans Whimsical.' },
      { category: 'Nouveauté', text: 'Tableaux blancs : import de diagrammes draw.io (fichier .drawio ou XML, compressé ou non, ou XML collé), depuis le clic droit « Importer » ou le bouton d’import : formes, textes, conteneurs, couleurs et liens sont repris.' },
      { category: 'Nouveauté', text: 'Liens : accroche précise n’importe où le long d’un côté, points de passage à ajouter, déplacer ou retirer (double-clic), segments d’un lien coudé à décaler pour qu’il passe ailleurs, et sauts aux croisements (arc, coupure ou pointe).' },
      { category: 'Nouveauté', text: 'Liens animés : tirets qui défilent, points qui circulent, pulsation ou comète, vers l’arrivée ou vers le départ, avec la vitesse et la couleur de son choix.' },
      { category: 'Amélioration', text: 'Espaces de documentation et de tableaux blancs : une pastille « Accès avec droit admin » signale un espace où l’on n’entre que par ses droits d’administration.' },
    ],
  },
  {
    version: '2.11.0',
    date: '2026-11-23',
    changes: [
      { category: 'Nouveauté', text: 'Tableaux blancs : nouveau mode « Maquette » pour prototyper des écrans comme dans Whimsical : fenêtre de navigateur, téléphone, barre de navigation, onglets, boutons, champs, cases à cocher, interrupteurs, curseurs, cartes, fenêtres de dialogue… Chaque composant a ses réglages : style, état coché, valeur, taille du texte et couleur.' },
      { category: 'Nouveauté', text: 'Tableaux blancs : l’épaisseur d’un lien se choisit, du trait fin à la grosse flèche pleine et cerclée (simple ou double), comme dans Google Drawings.' },
      { category: 'Correction', text: 'Tableaux blancs : les points bleus de liaison réapparaissent après un déplacement ou un zoom à la molette, sans devoir rappuyer sur C.' },
      { category: 'Correction', text: 'Tableaux blancs : la barre de mise en forme ne passe plus sur deux lignes par-dessus l’élément choisi.' },
      { category: 'Correction', text: 'Tableaux blancs : la touche / ouvre l’ajout rapide sans ouvrir aussi la recherche générale.' },
    ],
  },
  {
    version: '2.10.0',
    date: '2026-11-23',
    changes: [
      { category: 'Nouveauté', text: 'Documentation : « Actualiser depuis le disque » (réglages de l’espace) relit le dossier de l’espace sur le serveur : les notes, images et dossiers ajoutés à la main entrent dans l’espace, les fichiers modifiés à côté sont relus, et ceux qui ont disparu passent à la corbeille.' },
      { category: 'Nouveauté', text: 'Documentation : sélection multiple dans l’arbre des fichiers, comme dans un explorateur : Ctrl (Cmd) + clic, Maj + clic, Maj + flèches et Ctrl A ; la sélection se supprime (Suppr), se glisse vers un dossier ou s’ouvre dans des onglets.' },
      { category: 'Correction', text: 'Documentation : on ne peut plus avoir un fichier et un dossier choisis en même temps dans l’arbre.' },
    ],
  },
  {
    version: '2.9.0',
    date: '2026-11-23',
    changes: [
      { category: 'Nouveauté', text: 'Documentation : la recherche dans la note comprend la syntaxe de recherche d’Obsidian : "phrase exacte", OR, -mot, /expression/, match-case:, ignore-case:, tag:, task:, task-todo:, task-done:, line:( ) et section:( ), avec une aide (?) et « Expliquer la recherche ».' },
      { category: 'Amélioration', text: 'Documentation : en « Lecture et écriture », la recherche montre la syntaxe Markdown qu’elle trouve (chercher **s surligne **s, astérisques comprises), et un résultat dans un tableau ou un bloc s’affiche en Markdown ; en lecture, un lien propose de chercher dans le Markdown.' },
      { category: 'Amélioration', text: 'Documentation : dans un tableau, Maj Entrée fait un vrai retour à la ligne dans la cellule, sans afficher <br> (toujours visible avec « Modifier le Markdown »), et Haut et Bas parcourent les lignes de la cellule.' },
    ],
  },
  {
    version: '2.8.0',
    date: '2026-11-23',
    changes: [
      { category: 'Nouveauté', text: 'Documentation : les tableaux s’éditent comme dans Obsidian : poignées de ligne et de colonne (clic pour le menu, glisser pour déplacer), sélection de cellules à la souris, avec Maj ou Ctrl A, et copier, couper, coller ou vider (Suppr) une sélection, une ligne ou une colonne.' },
      { category: 'Nouveauté', text: 'Documentation : copier-coller de tableaux avec Excel, Google Sheets, Word ou Slides, dans les deux sens ; coller un tableau dans une note le transforme en tableau Markdown, et coller dans un tableau l’agrandit au besoin.' },
      { category: 'Amélioration', text: 'Documentation : dupliquer une ligne ou une colonne, et trier un tableau de A à Z ou de Z à A d’après une colonne.' },
      { category: 'Correction', text: 'Documentation : en « Lecture et écriture », la sélection de texte est bien visible dans une citation, un code ou un surlignage, sans déborder à côté du texte.' },
      { category: 'Correction', text: 'Documentation : le texte entre crochets ([REQ-012]), les mentions et les appels de notes de bas de page prennent la couleur des liens du thème, et les cases à cocher celle des puces.' },
    ],
  },
  {
    version: '2.7.0',
    date: '2026-11-23',
    changes: [
      { category: 'Nouveauté', text: 'Projets : rappel d’avancement (Réglages → Automatisation) : pendant une livraison en cours, chaque personne qui a des tickets « En cours » est invitée à mettre à jour son avancement, en pourcentage ou par un commentaire ; une balise dans l’en-tête du projet liste ses tickets, et les cartes indiquent qui ne l’a pas fait.' },
      { category: 'Nouveauté', text: 'Documentation : nouvelle recherche dans la note (Ctrl F), à la manière de VS Code : compteur de résultats, casse, mot entier, expressions régulières, et remplacement en écriture (Ctrl H).' },
      { category: 'Nouveauté', text: 'Documentation : un lien web s’ouvre dans un onglet de la documentation ; Ctrl clic l’ouvre dans une nouvelle page du navigateur, et Ctrl clic sur une note l’ouvre dans un nouvel onglet.' },
      { category: 'Nouveauté', text: 'Documentation : coloration syntaxique des blocs de code selon leur langage (```python, ```sql…), en lecture comme en écriture.' },
      { category: 'Nouveauté', text: 'Documentation : après « == », l’autocomplétion propose les billes de couleur des surlignages (==🟢 Validé==).' },
      { category: 'Amélioration', text: 'Documentation : l’arbre des fichiers garde en haut les dossiers ouverts pendant le défilement, comme dans VS Code, et les fichiers s’alignent à gauche, sous l’icône de leur dossier.' },
      { category: 'Amélioration', text: 'Documentation : passer de Lecture à Lecture et écriture ou à Écriture garde la même position dans la note.' },
      { category: 'Amélioration', text: 'Thèmes : avec les thèmes du site, le code en ligne, les citations, les puces et les en-têtes de tableau prennent la couleur du thème.' },
      { category: 'Correction', text: 'Documentation : les formules $…$ et les balises HTML en ligne (<sup>, <sub>, <kbd>, <mark>…) s’affichent aussi en « Lecture et écriture », même avec des _ ou des * dans la formule.' },
      { category: 'Correction', text: 'Documentation : les titres numérotés (« 1. Disponibilité ») gardent leur numéro dans le Sommaire, et les liens d’une table des matières (#1-disponibilite, {#id}, <a id>) mènent au bon titre.' },
    ],
  },
  {
    version: '2.6.4',
    date: '2026-11-20',
    changes: [
      { category: 'Correction', text: 'Documentation : en « Lecture et écriture », le gras, les citations et le code en ligne suivent le thème courant comme en lecture : couleur du gras dans une citation, barre et fond des citations sans italique, fond et police du code.' },
    ],
  },
  {
    version: '2.6.3',
    date: '2026-11-20',
    changes: [
      { category: 'Nouveauté', text: 'Documentation : chaque espace peut choisir, dans ses réglages, le dossier où vont les images collées ou glissées dans une note.' },
      { category: 'Amélioration', text: 'Administration : le dossier par défaut des images collées se règle dans Documentation, et s’appelle désormais « Pictures » au lieu de « images » ; les images déjà rangées ne bougent pas.' },
    ],
  },
  {
    version: '2.6.2',
    date: '2026-11-19',
    changes: [
      { category: 'Amélioration', text: 'Documentation : en écriture avec l’aperçu à côté, l’aperçu suit le curseur et le défilement de l’éditeur.' },
      { category: 'Correction', text: 'Documentation : les couleurs d’un thème personnalisé (titres, liens, code, citations…) s’appliquent aussi en « Lecture et écriture » et dans le source.' },
      { category: 'Correction', text: 'Documentation : sélectionner du texte ne surligne plus des bouts de mots partout dans la note ; seules les autres occurrences d’un mot entier sont marquées, discrètement, en « Écriture ».' },
    ],
  },
  {
    version: '2.6.1',
    date: '2026-11-18',
    changes: [
      { category: 'Amélioration', text: 'Notifications : un agent qui crée ou commente des tickets avec votre jeton d’API ne vous y abonne plus ; les personnes assignées ou mentionnées les suivent toujours.' },
      { category: 'Amélioration', text: 'Notifications : le niveau « Mentions seulement » devient « Mentions et assignations » et prévient aussi quand on vous assigne un ticket.' },
    ],
  },
  {
    version: '2.6.0',
    date: '2026-11-18',
    changes: [
      { category: 'Nouveauté', text: 'Thèmes personnalisés : chaque couleur se règle une à une, celles de l’interface comme celles du rendu des notes (titres, liens, code, citations, tableaux…), avec un aperçu en direct, et un thème peut avoir ses propres polices.' },
      { category: 'Nouveauté', text: 'Thèmes partagés : un thème s’exporte en fichier et s’importe, ou se publie dans la bibliothèque du site, où chacun l’ajoute à ses thèmes d’un clic.' },
      { category: 'Nouveauté', text: 'Tableaux blancs : grouper et dégrouper des éléments (Ctrl G, Ctrl Maj G ou clic droit) ; un clic prend tout le groupe, un double-clic y entre pour choisir un seul élément.' },
      { category: 'Nouveauté', text: 'Notifications : chacun choisit, projet par projet, ce qui le notifie (tout, sa participation par défaut, ses mentions seulement, ou rien), depuis la cloche de l’en-tête du projet ou Mon compte → Notifications.' },
      { category: 'Nouveauté', text: 'Notifications du navigateur : une notification système prévient quand FastBoard n’est pas au premier plan, et un clic ouvre le ticket ou la note.' },
      { category: 'Amélioration', text: 'Documentation : le texte des notes se centre sur l’écran pour lire sans tourner la tête ; dans Apparence, on peut aussi le centrer dans sa colonne ou lui laisser toute la largeur, et choisir sa police et sa taille.' },
      { category: 'Amélioration', text: 'Connexion : la session ne s’arrête plus 14 jours après la connexion mais après 30 jours sans utilisation, et la page de connexion mémorise l’adresse e-mail.' },
      { category: 'Amélioration', text: 'Tableaux blancs : clic droit (ou « ⋯ ») sur les tableaux de la vue d’ensemble d’un espace pour les ouvrir, renommer, dupliquer, partager ou supprimer.' },
      { category: 'Amélioration', text: 'Notifications : une personne mentionnée dans un ticket le suit, et le bouton « Suivre » se met à jour en direct.' },
      { category: 'Correction', text: 'Commentaires : l’avatar d’une personne mentionnée avec @ n’est plus écrasé.' },
    ],
  },
  {
    version: '2.5.0',
    date: '2026-11-17',
    changes: [
      { category: 'Nouveauté', text: 'Documentation : chaque espace a ses modèles de notes, en bas de l’arbre. Une nouvelle note peut partir d’un modèle : son titre, la date, l’heure et son auteur remplacent les variables.' },
      { category: 'Nouveauté', text: 'Documentation : « Enregistrer comme modèle » sur une note, et « Insérer un modèle » au curseur pendant l’écriture.' },
      { category: 'Amélioration', text: 'Assistant IA : il voit les modèles d’un espace de documentation et peut créer une note d’après l’un d’eux.' },
    ],
  },
  {
    version: '2.4.2',
    date: '2026-11-17',
    changes: [
      { category: 'Correction', text: 'Documentation : la bille de couleur d’un surlignage (==🟢 Titre==) ne s’affiche plus, elle donne seulement sa couleur, en lecture comme en « Lecture et écriture ».' },
      { category: 'Amélioration', text: 'Avancement : une personne dont la ligne n’est plus à 0 % est entourée de bleu (de vert une fois terminée), dans le ticket, les cartes, la liste et le Gantt.' },
    ],
  },
  {
    version: '2.4.1',
    date: '2026-11-17',
    changes: [{ category: 'Amélioration', text: 'Tableaux blancs : des nœuds de carte mentale glissés près d’un autre nœud s’y rattachent, comme dans Whimsical ; le nœud qui les recevra s’éclaire et un lien en pointillés montre le rattachement.' }],
  },
  {
    version: '2.4.0',
    date: '2026-11-17',
    changes: [
      {
        category: 'Nouveauté',
        text: 'Tableaux blancs : un nouvel espace de travail à la manière de Whimsical, rangé en espaces et en dossiers comme la documentation, et dessiné à plusieurs en temps réel.',
      },
      {
        category: 'Nouveauté',
        text: 'Tableaux blancs : quatre modes dans la barre latérale (diagramme, post-it avec votes, carte mentale, dessin libre), formes, liens, sections, sélection, zoom et annulation.',
      },
      { category: 'Nouveauté', text: 'Tableaux blancs : présence en direct, avec le curseur et le nom de chacun, ce que les autres ont sélectionné, et les éléments qui bougent pendant qu’on les déplace.' },
      { category: 'Nouveauté', text: 'Tableaux blancs : partage par adresse en plus des membres de l’espace, à toutes les personnes connectées, à une liste de personnes ou à tout le monde sans compte, en lecture ou en modification, avec un mot de passe au choix.' },
      { category: 'Nouveauté', text: 'Tableaux blancs : rétroliens, comme pour les notes : les notes et tickets qui mentionnent un tableau, les tableaux qui le montrent, et ce que montrent ses Fast Elements ; une note liste aussi les tableaux qui la citent.' },
      { category: 'Nouveauté', text: 'Tableaux blancs : clic droit « Ajouter un élément… » ou touche / : un ajout rapide avec recherche pose une forme, un texte, une icône, une image ou un modèle.' },
      { category: 'Nouveauté', text: 'Tableaux blancs : bibliothèque de plus de 2 000 icônes, couleur et épaisseur réglables, complétée par les icônes SVG ajoutées par les administrateurs.' },
      { category: 'Nouveauté', text: 'Tableaux blancs : images et SVG envoyés dans un espace (bouton, glisser-déposer ou coller), réutilisables par tous ses membres.' },
      { category: 'Nouveauté', text: 'Tableaux blancs : modèles façon « prefab » : une sélection devient un modèle, ses copies se posent en un clic, signalent quand le modèle change et se remettent à jour ; un modèle se modifie dans sa propre vue.' },
      { category: 'Nouveauté', text: 'Assistant IA : il lit les tableaux blancs et, si on l’autorise, y dessine (Mermaid), pose des post-it, modifie ou retire des éléments et crée des tableaux.' },
      { category: 'Nouveauté', text: 'Tableaux blancs : cartes mentales à la manière de Whimsical : un « + » sur le nœud choisi ajoute un enfant (ou un frère), plusieurs nœuds se déplacent d’un glisser avec leurs branches, et Alt + flèches les monte, les descend ou change leur niveau.' },
      { category: 'Nouveauté', text: 'Tableaux blancs : un Fast Element affiche un ticket, une note, un dossier, un espace de documentation ou un autre tableau, tenu à jour.' },
      { category: 'Nouveauté', text: 'Tableaux blancs : tableaux de données et graphiques Chart.js (barres, courbes, camembert, anneau, radar).' },
      {
        category: 'Nouveauté',
        text: 'Tableaux blancs : export d’une sélection en Markdown Mermaid, et import d’un organigramme ou d’une carte mentale Mermaid, mis en page automatiquement.',
      },
      { category: 'Nouveauté', text: 'Documentation et tickets : @ mentionne un tableau blanc, avec son aperçu au survol ; seul sur sa ligne, il s’affiche en grand aperçu, en thème clair ou sombre.' },
      { category: 'Correction', text: 'Assistant IA : un fournisseur en HTTPS signé par l’autorité de votre entreprise (ou derrière un proxy qui inspecte le HTTPS) est reconnu, et une connexion qui échoue en donne la cause au lieu de « fetch failed ».' },
      { category: 'Amélioration', text: 'Assistant IA : option « Vérifier le certificat HTTPS » par fournisseur, pour un serveur au certificat auto-signé.' },
    ],
  },
  {
    version: '2.3.0',
    date: '2026-11-17',
    changes: [
      {
        category: 'Nouveauté',
        text: 'Documentation : [[ propose les notes et les images de l’espace, cherchées par leur nom ou leur chemin, avec une miniature des images ; [[# propose les titres de la note.',
      },
      { category: 'Nouveauté', text: 'Documentation : un surlignage qui commence par une bille de couleur (==🟢 Validé==) prend sa couleur, comme dans Obsidian.' },
      { category: 'Amélioration', text: 'Documentation : la taille d’une image notée à la manière d’Obsidian (![[image.png|300]]) est respectée.' },
      { category: 'Correction', text: 'Documentation : les images ![[Dossier/image.png]] s’affichent en « Lecture et écriture », et un chemin partiel retrouve l’image où qu’elle soit dans l’espace.' },
      {
        category: 'Correction',
        text: 'Documentation : un lien vers un titre de la note ([Texte](#Titre), [[#Titre]]) y amène au lieu de passer en écriture, même quand l’ancre est écrite autrement (tirets, ^).',
      },
    ],
  },
  {
    version: '2.2.0',
    date: '2026-11-16',
    changes: [
      { category: 'Nouveauté', text: 'Navigation : une barre latérale remplace la barre du haut, pour laisser toute la hauteur au contenu. Le compte est en bas, l’assistant et les notifications aussi.' },
      { category: 'Nouveauté', text: 'Recherche : une palette au centre de l’écran (Ctrl K), qui propose vos favoris avant même de taper.' },
      { category: 'Nouveauté', text: 'Documentation : des onglets comme dans Obsidian, chacun avec ses flèches précédent et suivant, et une page d’accueil avec vos favoris et les notes récentes.' },
      { category: 'Nouveauté', text: 'Documentation : les favoris, sur une note ou d’un clic droit, se retrouvent en tête de la page Documentations et dans la recherche.' },
      { category: 'Nouveauté', text: 'Documentation : « Lecture et écriture » fonctionne comme Obsidian : le texte reste rendu, et seule la syntaxe sous le curseur réapparaît.' },
      {
        category: 'Nouveauté',
        text: 'Documentation : support du Markdown Obsidian, réglable par espace et activé d’office : callouts, ==surlignage==, %%commentaires%%, #étiquettes, notes de bas de page, propriétés et notes intégrées.',
      },
      { category: 'Nouveauté', text: 'Documentation : un espace peut devenir un site web en lecture seule, ouvert à ses membres, à des personnes choisies ou à tout le monde, avec sa page d’accueil, sa recherche (Ctrl K), son sommaire et un thème sombre.' },
      { category: 'Nouveauté', text: 'Documentation : les tableaux s’écrivent directement dans leurs cellules en « Lecture et écriture », comme dans Obsidian ; Tab et Entrée passent d’une cellule à l’autre, le clic droit ajoute, déplace ou aligne lignes et colonnes.' },
      { category: 'Nouveauté', text: 'Assistant IA : « Éditer », à côté du contexte, choisit à la main les projets, tickets, espaces et notes à lui donner, avec des suggestions (éléments parents et en lien) et une recherche.' },
      { category: 'Amélioration', text: 'Documentation : rétroliens, liens, commentaires et compte des mots sont réunis en bas à droite, et s’ouvrent dans un panneau flottant.' },
      { category: 'Amélioration', text: 'Documentation : un clic sur un dossier le sélectionne, la flèche le déplie ; le clic droit donne ses infos (taille totale comprise) et une note sur son rôle.' },
      { category: 'Amélioration', text: 'Documentation : le clic droit sur un bloc rendu (tableau, code, callout…) propose « Modifier le Markdown ».' },
      { category: 'Amélioration', text: 'Documentation : les images s’ouvrent en plein écran ; au survol ou au clic droit, deux boutons pour les agrandir ou modifier leur Markdown.' },
      { category: 'Amélioration', text: 'Documentation : un ticket mentionné montre son aperçu au survol, aussi en « Lecture et écriture ».' },
      { category: 'Amélioration', text: 'Documentation : la colonne des fichiers se replie pour laisser toute la largeur à la note.' },
      { category: 'Correction', text: 'Documentation : précédent et suivant du navigateur passent d’une note à l’autre au lieu de quitter la page.' },
      { category: 'Correction', text: 'Projets : les liens vers l’API restent en bas de la page.' },
      { category: 'Correction', text: 'Documentation : la coloration du source reste lisible sur fond sombre.' },
    ],
  },
  {
    version: '2.1.0',
    date: '2026-11-05',
    changes: [
      { category: 'Nouveauté', text: 'Documentation : un sommaire à gauche de la note, en lecture et en lecture et écriture, reprend ses titres et sous-titres et y amène d’un clic.' },
      {
        category: 'Nouveauté',
        text: 'Documentation : à l’import d’un fichier ou d’un ZIP, un comparateur montre les deux versions côte à côte, avec ce qui est ajouté, retiré ou changé. Vous choisissez bloc par bloc, et le résultat reste modifiable avant d’importer.',
      },
      { category: 'Nouveauté', text: 'Documentation : le même comparateur dans l’historique d’une note, pour ne reprendre que certains blocs d’une ancienne version.' },
      { category: 'Nouveauté', text: 'Assistant IA : il connaît la note ouverte, cherche et lit dans la documentation, et peut créer ou modifier des notes avec vos droits, en vous montrant chaque changement.' },
      { category: 'Amélioration', text: 'Documentation : importer ou exporter un .md se fait au clic droit dans l’arbre, y compris pour déposer un nouveau fichier dans un dossier.' },
      { category: 'Amélioration', text: 'Avancement : des lignes bien plus compactes, sur une seule ligne quand le texte le permet. Le crayon, la poignée et la suppression apparaissent au survol.' },
      { category: 'Amélioration', text: 'Avancement : une ligne est terminée quand sa barre atteint 100 %, sans case à cocher. La supprimer demande une confirmation.' },
      { category: 'Correction', text: 'Documentation : un fichier enregistré sous Windows n’apparaît plus comme entièrement modifié à l’import.' },
      { category: 'Correction', text: 'Documentation : ce qui venait d’être tapé reste dans l’historique quand la note est remplacée par un import ou une restauration.' },
    ],
  },
  {
    version: '2.0.0',
    date: '2026-11-04',
    changes: [
      {
        category: 'Nouveauté',
        text: 'Documentation : nouvel onglet « Documentations », activable dans l’administration. Des espaces de fichiers Markdown en dossiers, écrits à plusieurs en temps réel, avec lecture et écriture, Mermaid, images, membres et rôles, et 15 jours d’historique et de corbeille.',
      },
      {
        category: 'Nouveauté',
        text: 'Documentation : nouveau mode « Lecture et écriture ». La note s’affiche rendue, et un clic sur un texte ou un bloc le modifie directement.',
      },
      {
        category: 'Nouveauté',
        text: 'Documentation : barre d’outils, commandes / et menu du clic droit pour écrire plus vite : titres, listes, tableaux, code, Mermaid, images, blocs à dupliquer ou déplacer.',
      },
      {
        category: 'Nouveauté',
        text: 'Documentation : un clic droit sur un passage sélectionné permet de le commenter, de mentionner des personnes, de répondre et de résoudre le fil.',
      },
      {
        category: 'Nouveauté',
        text: 'Documentation : les liens et rétroliens d’une note, notes et tickets, sont visibles d’un coup d’œil.',
      },
      {
        category: 'Nouveauté',
        text: 'Documentation : export et réimport avec fusion ligne à ligne, d’un clic droit sur un espace, un dossier ou un fichier. Le ZIP reproduit exactement l’arborescence et s’ouvre comme un coffre Obsidian.',
      },
      {
        category: 'Nouveauté',
        text: 'La recherche générale trouve aussi les documents, par leur titre ou leur contenu.',
      },
      {
        category: 'Nouveauté',
        text: 'Le survol d’une mention de ticket affiche un aperçu du ticket, et celui du nombre de commentaires affiche les derniers commentaires.',
      },
      {
        category: 'Nouveauté',
        text: 'Mentions : @ propose aussi les fichiers de documentation dans les tickets, et les personnes, tickets et fichiers dans les documents.',
      },
      {
        category: 'Nouveauté',
        text: 'Administration : nouvel onglet « Authentification » pour se connecter avec un annuaire LDAP (LDAP, LDAPS ou StartTLS), avec un profil classique, un profil spécifique, des champs personnalisables et un test des réglages.',
      },
      {
        category: 'Nouveauté',
        text: 'Quand le navigateur utilise une autre version que le serveur (page en cache, onglet resté ouvert), un message en bas de page propose de mettre à jour.',
      },
      {
        category: 'Nouveauté',
        text: 'Fenêtre d’un ticket : le bouton + du bloc « Avancement » ajoute des lignes libres, avec ou sans personne, et plusieurs lignes par personne si besoin.',
      },
      {
        category: 'Amélioration',
        text: 'Les sous-tâches disparaissent au profit des lignes d’avancement : celles existantes y sont reprises et comptent désormais dans la progression du ticket.',
      },
      {
        category: 'Amélioration',
        text: 'API : les routes /subtasks et /tickets/{id}/assignees/{userId} sont remplacées par /tickets/{id}/parts et /parts/{id}.',
      },
      {
        category: 'Correction',
        text: 'Éditeur de description : les icônes Gras et Italique s’affichent de nouveau.',
      },
    ],
  },
  {
    version: '1.10.0',
    date: '2026-11-03',
    changes: [
      {
        category: 'Nouveauté',
        text: 'Assistant IA : joignez des fichiers à vos questions (PDF, CSV, texte, JSON…) avec le trombone, en les glissant sur le panneau ou en les collant ; leur texte est lu par tous les modèles, et un PDF scanné est lu en images par un modèle avec vision.',
      },
    ],
  },
  {
    version: '1.9.0',
    date: '2026-11-03',
    changes: [
      { category: 'Nouveauté', text: 'Analyseur : dans « Reste à faire », les tickets ajoutés en cours de sprint font remonter les courbes réelle et idéale le jour de leur ajout, avec des barres qui comptent les ajouts (interrupteur « Tickets ajoutés », aussi dans le rapport PDF).' },
      { category: 'Amélioration', text: 'Fenêtre d’un ticket : sous « Livraison ciblée », une sélection rapide propose la version en cours et la prochaine livraison.' },
    ],
  },
  {
    version: '1.8.0',
    date: '2026-11-02',
    changes: [
      { category: 'Nouveauté', text: 'Ticket avec des sous-tickets : son avancement suit celui de ses sous-tickets (réglable dans l’Avancement du ticket, activé par défaut).' },
    ],
  },
  {
    version: '1.7.1',
    date: '2026-10-29',
    changes: [
      { category: 'Sécurité', text: 'Mise à jour de body-parser (2.4.0) : corrige un déni de service possible avec un corps de requête compressé.' },
      { category: 'Correction', text: 'Analyseur : le raccourci vers la version en cours ne chevauche plus le choix de la livraison.' },
      { category: 'Correction', text: 'Le bouton de l’assistant IA dans l’en-tête d’un ticket reprend l’icône du cerveau.' },
    ],
  },
  {
    version: '1.7.0',
    date: '2026-10-29',
    changes: [
      { category: 'Nouveauté', text: 'L’assistant IA s’ouvre par-dessus un ticket, avec un bouton dans l’en-tête du ticket ; il connaît le ticket ouvert.' },
      { category: 'Nouveauté', text: 'Analyseur : raccourci vers la version en cours (ou la prochaine) à côté du choix de la livraison.' },
      { category: 'Amélioration', text: 'Analyseur : la charge par personne détaille chaque colonne du Kanban, avec ses couleurs (aussi dans le rapport PDF).' },
      { category: 'Amélioration', text: 'Option du projet (activée par défaut) : les tickets terminés ne sont plus comptés dans « Non assigné » de la charge par personne.' },
      { category: 'Amélioration', text: 'Un ticket créé depuis une vue filtrée reprend la catégorie, la livraison et les personnes filtrées.' },
    ],
  },
  {
    version: '1.6.0',
    date: '2026-10-26',
    changes: [
      { category: 'Nouveauté', text: 'Activités : commentez chaque évènement du journal, avec des mentions @ qui notifient les personnes.' },
      { category: 'Nouveauté', text: 'Réglages du projet : autoriser la création de composants et de choix de listes directement depuis les tickets.' },
      { category: 'Nouveauté', text: 'Analyseur : le burn-down affiche aussi, en orange, le reste à faire en comptant les tickets « À tester ».' },
      { category: 'Correction', text: 'Administration des utilisateurs : la dernière activité se met à jour même quand la session est réutilisée pendant des jours.' },
      { category: 'Correction', text: 'Bouton Suivre plus clair : « Suivre » pour s’abonner, « Suivi » une fois abonné et « Ne plus suivre » au survol.' },
    ],
  },
  {
    version: '1.5.0',
    date: '2026-10-23',
    changes: [
      { category: 'Nouveauté', text: 'Réglages du projet, onglet Ticket : afficher ou masquer chaque champ des tickets (les valeurs sont conservées).' },
      { category: 'Nouveauté', text: 'Champs personnalisés des tickets : texte, nombre, date, liste, choix multiples, case à cocher, lien ou personne, avec leur libellé, affichables sur les cartes.' },
      { category: 'Nouveauté', text: 'Apparence : créez vos propres thèmes (couleur principale, surfaces, clair ou sombre, style) avec aperçu en direct.' },
      { category: 'Nouveauté', text: 'Apparence : choix des polices du texte, des titres et du code, et de la taille du texte.' },
      { category: 'Correction', text: 'Gantt : les mois, les semaines et les jours de l’en-tête ne se superposent plus.' },
    ],
  },
  {
    version: '1.4.0',
    date: '2026-10-23',
    changes: [
      { category: 'Nouveauté', text: 'Sous-tickets rattachés à un ticket parent, comme les sous-tâches de Jira : de vrais tickets, visibles sur le Kanban.' },
      { category: 'Nouveauté', text: 'Assistant IA : voir chaque modification, l’annuler ou la réappliquer, ou se faire proposer les modifications pour les valider une à une.' },
      { category: 'Nouveauté', text: 'Assistant IA : historique des 50 dernières conversations, panneau élargissable et page dédiée à ouvrir dans un autre onglet.' },
      { category: 'Nouveauté', text: 'Administration IA : plusieurs fournisseurs, délai de réponse par fournisseur, tours de réflexion et de discussion maximum.' },
      { category: 'Nouveauté', text: 'Administration : onglet HTTP / HTTPS (certificats PEM ou PFX, redirection, HSTS, proxy inverse, certificat auto-signé), appliqué sans redémarrer.' },
      { category: 'Nouveauté', text: 'Réglages du projet : onglet Ticket, pour masquer l’avancement des tickets à 0 %.' },
      { category: 'Amélioration', text: 'Assistant IA : la réflexion est repliée et affiche sa dernière étape ; le raisonnement des modèles qui l’exposent y figure.' },
      { category: 'Amélioration', text: 'Bouton « M’assigner » au-dessus des assignés d’un ticket.' },
      { category: 'Amélioration', text: 'Les flèches de dépendances indiquent aussi les tickets hors de vue ou masqués par les filtres.' },
      { category: 'Amélioration', text: 'Cliquer sur l’avatar d’une personne connectée ouvre la vue ou le ticket qu’elle regarde.' },
    ],
  },
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
