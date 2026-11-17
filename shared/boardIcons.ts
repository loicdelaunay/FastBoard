import { icons } from 'lucide';

/**
 * Bibliothèque d'icônes intégrée des tableaux blancs : les icônes Lucide (licence ISC), dessinées au trait sur une grille
 * de 24 × 24, donc recolorables et d'épaisseur réglable. Un élément les désigne par `lucide:{nom}`.
 */

export type IconNode = ReadonlyArray<readonly [string, Readonly<Record<string, string | number | undefined>>]>;

export interface LibraryIcon {
  /** Identifiant enregistré dans l'élément : `lucide:camera`. */
  id: string;
  name: string;
  /** Noms (et anciens noms) en minuscules, pour la recherche. */
  words: string;
  node: IconNode;
}

const kebab = (name: string): string =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-zA-Z])(\d)/g, '$1-$2')
    .toLowerCase();

let catalog: LibraryIcon[] | null = null;
let byId: Map<string, LibraryIcon> | null = null;

/** Toutes les icônes intégrées, une seule fois chacune (les anciens noms servent à la recherche). */
export function libraryIcons(): LibraryIcon[] {
  if (catalog) return catalog;
  const groups = new Map<IconNode, string[]>();
  for (const [name, node] of Object.entries(icons as Record<string, IconNode>)) {
    const names = groups.get(node);
    if (names) names.push(kebab(name));
    else groups.set(node, [kebab(name)]);
  }
  catalog = [...groups.entries()]
    .map(([node, names]) => ({ id: `lucide:${names[0]!}`, name: names[0]!, words: names.join(' ').replace(/-/g, ' '), node }))
    .sort((a, b) => a.name.localeCompare(b.name));
  byId = new Map(catalog.map((icon) => [icon.id, icon]));
  return catalog;
}

export function libraryIcon(id: string): LibraryIcon | undefined {
  if (!byId) libraryIcons();
  return byId!.get(id);
}

const escape = (value: string): string => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** Contenu SVG d'une icône (sans la balise `<svg>`), attributs échappés. */
export function iconMarkup(node: IconNode): string {
  return node
    .map(([tag, attributes]) => {
      const attrs = Object.entries(attributes)
        .filter(([name, value]) => value !== undefined && /^[a-z][a-z0-9-]*$/i.test(name) && name !== 'key')
        .map(([name, value]) => `${name}="${escape(String(value))}"`)
        .join(' ');
      return /^[a-z]+$/.test(tag) ? `<${tag} ${attrs}/>` : '';
    })
    .join('');
}

/** Mots français vers les noms anglais des icônes, pour chercher dans sa langue. */
const FRENCH: Record<string, string> = {
  // Directions, formes et actions
  droite: 'right',
  gauche: 'left',
  haut: 'up top',
  bas: 'down bottom',
  cercle: 'circle',
  rond: 'circle',
  carre: 'square',
  ajouter: 'plus add',
  supprimer: 'trash x delete',
  modifier: 'pencil edit',
  copier: 'copy',
  coller: 'clipboard',
  enregistrer: 'save',
  sauvegarder: 'save',
  ouvrir: 'folder-open open',
  fermer: 'x close',
  filtre: 'filter',
  trier: 'arrow-up-down sort',
  loupe: 'search zoom',
  epingle: 'pin',
  etiquette: 'tag',
  signet: 'bookmark',
  lecture: 'play',
  son: 'volume',
  groupe: 'users group',
  personnes: 'users',
  entreprise: 'building briefcase',
  contrat: 'file-signature file-text',
  signature: 'signature pen',
  interdit: 'ban',
  refus: 'ban x',
  // Objets et notions
  accueil: 'house home',
  aide: 'help circle-help',
  alerte: 'alert triangle-alert bell',
  ampoule: 'lightbulb',
  appareil: 'camera',
  argent: 'banknote wallet coins',
  arbre: 'tree',
  attention: 'alert triangle-alert',
  avion: 'plane',
  base: 'database',
  batiment: 'building',
  batterie: 'battery',
  bouclier: 'shield',
  boite: 'box package',
  bureau: 'briefcase building',
  cadenas: 'lock',
  cadeau: 'gift',
  calendrier: 'calendar',
  camion: 'truck',
  carte: 'map credit-card',
  chat: 'cat message',
  chien: 'dog',
  cible: 'target',
  cle: 'key wrench',
  cloche: 'bell',
  code: 'code terminal',
  coeur: 'heart',
  colis: 'package',
  commentaire: 'message',
  conteneur: 'container',
  coche: 'check',
  courriel: 'mail',
  crayon: 'pencil pen',
  croix: 'x',
  disque: 'hard-drive disc',
  discussion: 'messages message',
  document: 'file text',
  donnees: 'database',
  dossier: 'folder',
  drapeau: 'flag',
  eclair: 'zap',
  ecole: 'school',
  ecran: 'monitor screen',
  eau: 'droplet waves',
  engrenage: 'cog settings',
  envoyer: 'send upload',
  equipe: 'users',
  erreur: 'circle-x bug',
  etoile: 'star',
  euro: 'euro',
  facture: 'receipt',
  feu: 'flame',
  feuille: 'leaf file',
  fichier: 'file',
  fleche: 'arrow',
  fusee: 'rocket',
  globe: 'globe earth',
  graphique: 'chart',
  grille: 'grid',
  horloge: 'clock',
  hopital: 'hospital',
  idee: 'lightbulb',
  image: 'image picture',
  imprimante: 'printer',
  information: 'info',
  lien: 'link',
  liste: 'list',
  livre: 'book',
  localisation: 'map-pin',
  lune: 'moon',
  magasin: 'store',
  maison: 'house home',
  marteau: 'hammer',
  message: 'message mail',
  micro: 'mic',
  moins: 'minus',
  musique: 'music',
  nuage: 'cloud',
  objectif: 'target goal',
  oeil: 'eye',
  ordinateur: 'laptop computer monitor',
  outil: 'wrench tool hammer',
  paiement: 'credit-card wallet',
  panier: 'shopping-cart basket',
  partager: 'share',
  personne: 'user person',
  photo: 'camera image',
  pluie: 'cloud-rain',
  plus: 'plus',
  poubelle: 'trash',
  presse: 'clipboard',
  question: 'circle-help help',
  recherche: 'search',
  reglages: 'settings cog sliders',
  reseau: 'network wifi',
  robot: 'bot',
  sablier: 'hourglass',
  securite: 'shield lock',
  serveur: 'server',
  soleil: 'sun',
  statistiques: 'chart bar trending',
  tableau: 'table layout',
  tache: 'list-checks check',
  telecharger: 'download',
  telephone: 'phone smartphone',
  temps: 'timer clock',
  tendance: 'trending',
  terminal: 'terminal',
  trophee: 'trophy',
  usine: 'factory',
  utilisateur: 'user',
  utilisateurs: 'users',
  valider: 'check circle-check',
  video: 'video',
  voiture: 'car',
};

const fold = (value: string): string => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Icônes intégrées qui correspondent à une recherche (en anglais ou en français), les plus proches d'abord. */
export function searchLibraryIcons(query: string, limit = 120): LibraryIcon[] {
  const all = libraryIcons();
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return all.slice(0, limit);
  // Un mot français ajoute ses équivalents anglais ; chaque mot doit trouver l'un de ses termes.
  const terms = words.map((word) => [word, ...Object.entries(FRENCH).flatMap(([french, english]) => (french.startsWith(word) || (word.length > 3 && word.startsWith(french)) ? english.split(' ') : []))]);
  const scored: Array<{ icon: LibraryIcon; score: number }> = [];
  for (const icon of all) {
    let score = 0;
    let matched = true;
    for (const options of terms) {
      const best = Math.min(...options.map((term) => (icon.name === term ? 0 : icon.name.startsWith(term) ? 1 : icon.words.includes(term) ? 2 : 9)));
      if (best === 9) {
        matched = false;
        break;
      }
      score += best;
    }
    if (matched) scored.push({ icon, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.icon.name.length - b.icon.name.length)
    .slice(0, limit)
    .map((entry) => entry.icon);
}
