import { StateEffect, StateField, type EditorState } from '@codemirror/state';
import { showTooltip, type EditorView, type Tooltip } from '@codemirror/view';
import { boardMentionView, MENTION_VIEW_SUFFIX, type BoardMentionView } from '@shared/boards';
import { t } from '@/i18n';
import { mentionToken } from '@/utils/mentions';

/**
 * Affichage d'un tableau blanc cité dans une note, au choix comme dans Whimsical : simple lien, carte (nom et aperçu),
 * image seule, ou vue intégrée où l'on se déplace. Le choix s'écrit dans la mention (`@[Titre](board:7#image)`) ; il se
 * fait dans la petite barre qui suit la mention qu'on vient de poser, au clic droit, ou sur le tableau affiché.
 */

export interface BoardMention {
  from: number;
  to: number;
  id: number;
  label: string;
  /** Affichage écrit dans la mention, ou `null` : carte si elle est seule sur sa ligne, lien sinon. */
  view: BoardMentionView | null;
  /** La mention occupe sa ligne à elle seule : elle peut s'afficher en bloc. */
  alone: boolean;
}

const BOARD_MENTION = new RegExp(String.raw`@\[([^\]\n]{1,80})\]\(board:(\d+)${MENTION_VIEW_SUFFIX}\)`, 'g');

/** Les affichages proposés, dans l'ordre. */
export function boardViewChoices(): Array<{ view: BoardMentionView; label: string; hint: string; icon: string }> {
  return [
    { view: 'link', label: t('Lien'), hint: t('Le nom du tableau, dans le texte'), icon: 'pi pi-link' },
    { view: 'card', label: t('Carte'), hint: t('Son nom et son aperçu'), icon: 'pi pi-id-card' },
    { view: 'image', label: t('Image'), hint: t('Son image seule'), icon: 'pi pi-image' },
    { view: 'embed', label: t('Intégré'), hint: t('Une vue où l’on se déplace et où l’on zoome'), icon: 'pi pi-window-maximize' },
  ];
}

/** Mention de tableau blanc écrite sous une position du texte. */
export function boardMentionAt(state: EditorState, position: number): BoardMention | null {
  const line = state.doc.lineAt(Math.min(Math.max(position, 0), state.doc.length));
  for (const match of line.text.matchAll(BOARD_MENTION)) {
    const from = line.from + match.index;
    const to = from + match[0].length;
    if (position < from || position > to) continue;
    return { from, to, id: Number(match[2]), label: match[1]!, view: boardMentionView(match[3]), alone: line.text.trim() === match[0] };
  }
  return null;
}

/** Affichage effectif d'une mention : celui qu'elle demande, sinon carte quand elle est seule sur sa ligne. */
export function shownBoardView(mention: BoardMention): BoardMentionView {
  if (!mention.alone) return 'link';
  return mention.view ?? 'card';
}

/**
 * Change l'affichage d'une mention. Carte, image et vue intégrée sont des blocs : la mention passe sur sa propre ligne
 * si elle était au milieu d'un texte.
 */
export function setBoardMentionView(view: EditorView, mention: BoardMention, shown: BoardMentionView): void {
  const { doc } = view.state;
  const line = doc.lineAt(mention.from);
  let insert = mentionToken('board', mention.id, mention.label, shown);
  let from = mention.from;
  let to = mention.to;
  let split = false;
  if (shown !== 'link') {
    const before = doc.sliceString(line.from, mention.from);
    const after = doc.sliceString(mention.to, line.to);
    // Les espaces autour de la mention partent avec elle : pas de ligne qui finit ou commence par un blanc.
    if (before.trim()) from -= before.length - before.trimEnd().length;
    to += after.length - after.trimStart().length;
    split = Boolean(after.trim());
    insert = `${before.trim() ? '\n\n' : ''}${insert}${split ? '\n\n' : ''}`;
  }
  // Le curseur va après la mention, hors de sa ligne quand elle s'affiche en bloc : le résultat se voit tout de suite
  // (en « Lecture et écriture », une ligne où se trouve le curseur montre son Markdown).
  let anchor = from + insert.length;
  if (shown !== 'link' && !split) {
    if (line.number < doc.lines) anchor = line.to + 1 + insert.length - (to - from);
    else {
      insert += '\n';
      anchor = from + insert.length;
    }
  }
  view.dispatch({ changes: { from, to, insert }, effects: showBoardChoice.of(null), selection: { anchor }, userEvent: 'input' });
  view.focus();
}

// --- Petite barre de choix sous la mention qu'on vient de poser ---------------------------------------------------------

/** Montre (position de la mention) ou retire (`null`) la barre de choix. */
export const showBoardChoice = StateEffect.define<number | null>();

function choiceBar(view: EditorView, position: number): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'cm-board-choice';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', t('Affichage du tableau'));
  const caption = document.createElement('span');
  caption.className = 'cm-board-choice-label';
  caption.textContent = t('Afficher en');
  bar.append(caption);
  const mention = boardMentionAt(view.state, position);
  const current = mention ? shownBoardView(mention) : 'link';
  for (const choice of boardViewChoices()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = choice.view === current ? 'active' : '';
    button.title = choice.hint;
    button.setAttribute('aria-pressed', String(choice.view === current));
    button.innerHTML = `<i class="${choice.icon}"></i>`;
    button.append(choice.label);
    // Le curseur reste dans le texte : on peut ignorer la barre et continuer d'écrire.
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      const found = boardMentionAt(view.state, position);
      if (found) setBoardMentionView(view, found, choice.view);
    });
    bar.append(button);
  }
  return bar;
}

/**
 * La barre apparaît quand on vient de citer un tableau, et disparaît dès qu'on écrit ou qu'on déplace le curseur : elle
 * n'interrompt pas la frappe.
 */
export const boardChoice = StateField.define<number | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(showBoardChoice)) return effect.value;
    return value !== null && (transaction.docChanged || transaction.selection) ? null : value;
  },
  provide: (field) =>
    showTooltip.from(field, (position): Tooltip | null =>
      position === null ? null : { pos: position, above: false, arrow: false, create: (view) => ({ dom: choiceBar(view, position) }) },
    ),
});
