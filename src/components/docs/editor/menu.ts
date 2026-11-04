import type { EditorView } from '@codemirror/view';
import type { MenuItem } from 'primevue/menuitem';
import type { DocQuote } from '@shared/docComments';
import { t } from '@/i18n';
import type { MarkdownBlock } from '@/utils/markdown';
import { addTableColumn, addTableRow, deleteBlock, duplicateBlock, isTaskDone, swapBlocks, toggleTask, type TextRange } from './commands';
import { inlineTools, insertTools, lineTools, type DocTool, type ToolHandlers } from './tools';

/** Ce qui se trouve sous le clic droit. */
export interface MenuTarget {
  /** Position dans le texte. */
  position: number;
  block: MarkdownBlock | null;
  /** Passage sélectionné : ses bornes dans le source, et son ancre pour un commentaire. */
  selection: TextRange | null;
  quote: DocQuote | null;
  /** Texte à copier. */
  selected: string;
  link: { open: () => void; address: string | null } | null;
  /** Ligne de la case à cocher. */
  task: number | null;
  /** Code du bloc. */
  code: string | null;
}

export interface MenuHandlers extends ToolHandlers {
  comment: (quote: DocQuote) => void;
  copy: (text: string) => void;
  /** Blocs de la note, pour trouver les voisins d'un bloc à déplacer. */
  blocks: () => MarkdownBlock[];
}

const toItem = (view: EditorView, tool: DocTool, range: TextRange): MenuItem => ({ label: tool.label, icon: tool.icon, command: () => tool.run(view, range) });

export function editorMenu(view: EditorView, target: MenuTarget, handlers: MenuHandlers): MenuItem[] {
  const { block, selection, quote, link, task, code } = target;
  const here: TextRange = selection ?? block ?? { from: target.position, to: target.position };
  const items: MenuItem[] = [];

  if (quote) items.push({ label: t('Ajouter un commentaire'), icon: 'pi pi-comment', command: () => handlers.comment(quote) });
  if (link) {
    items.push({ label: t('Ouvrir le lien'), icon: 'pi pi-external-link', command: link.open });
    if (link.address !== null) items.push({ label: t('Copier le lien'), icon: 'pi pi-copy', command: () => handlers.copy(link.address!) });
  }
  if (target.selected) items.push({ label: t('Copier'), icon: 'pi pi-copy', command: () => handlers.copy(target.selected) });
  if (items.length) items.push({ separator: true });

  if (selection) items.push(...inlineTools().map((tool) => toItem(view, tool, selection)), { separator: true });

  if (task !== null) items.push({ label: isTaskDone(view, task) ? t('Décocher') : t('Cocher'), icon: 'pi pi-check-square', command: () => toggleTask(view, task) });
  if (block?.type === 'table') {
    items.push({ label: t('Ajouter une ligne'), icon: 'pi pi-plus', command: () => addTableRow(view, block) }, { label: t('Ajouter une colonne'), icon: 'pi pi-plus', command: () => addTableColumn(view, block) });
  }
  if (code !== null) items.push({ label: t('Copier le code'), icon: 'pi pi-copy', command: () => handlers.copy(code) });
  if (items.at(-1) && !items.at(-1)!.separator) items.push({ separator: true });

  items.push(
    { label: t('Transformer en'), icon: 'pi pi-sync', items: lineTools().map((tool) => toItem(view, tool, here)) },
    { label: t('Insérer'), icon: 'pi pi-plus-circle', items: insertTools(handlers).map((tool) => toItem(view, tool, here)) },
  );

  if (block) {
    const blocks = handlers.blocks();
    const index = blocks.findIndex((entry) => entry.from === block.from);
    const previous = blocks[index - 1];
    const next = blocks[index + 1];
    items.push({
      label: t('Bloc'),
      icon: 'pi pi-th-large',
      items: [
        { label: t('Dupliquer'), icon: 'pi pi-clone', command: () => duplicateBlock(view, block) },
        { label: t('Monter'), icon: 'pi pi-arrow-up', disabled: !previous, command: () => previous && swapBlocks(view, previous, block) },
        { label: t('Descendre'), icon: 'pi pi-arrow-down', disabled: !next, command: () => next && swapBlocks(view, block, next) },
        { label: t('Supprimer'), icon: 'pi pi-trash', command: () => deleteBlock(view, block) },
      ],
    });
  }
  return items;
}
