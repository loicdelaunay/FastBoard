import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import type { DiffPick } from '@shared/docDiff';

/**
 * Résultat du comparateur : un texte que l'on peut écrire librement, où l'on garde la place de chaque bloc. Cocher un
 * autre côté ne remplace donc que ce bloc, sans perdre ce qui a été retouché ailleurs.
 */

export interface MergeBlock extends DiffPick {
  from: number;
  to: number;
}

export const setBlocks = StateEffect.define<MergeBlock[]>();

export const mergeBlocks = StateField.define<MergeBlock[]>({
  create: () => [],
  update(blocks, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setBlocks)) return effect.value;
    }
    if (!transaction.docChanged) return blocks;
    const { changes } = transaction;
    return blocks.map((block) => ({
      ...block,
      // Écrire au début d'un bloc le prolonge ; écrire juste après lui revient à la ligne suivante.
      from: changes.mapPos(block.from, -1),
      to: changes.mapPos(block.to, block.to > block.from ? -1 : 1),
      // Écrire à la place d'un bloc en attente, c'est le trancher à la main.
      decided: block.decided || changes.touchesRange(block.from, block.to) !== false,
    }));
  },
});

class PendingWidget extends WidgetType {
  readonly index: number;
  readonly label: string;

  constructor(index: number, label: string) {
    super();
    this.index = index;
    this.label = label;
  }

  override eq(other: PendingWidget): boolean {
    return other.index === this.index && other.label === this.label;
  }

  override toDOM(): HTMLElement {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'cm-merge-pending';
    chip.dataset.mergeBlock = String(this.index);
    chip.textContent = this.label;
    return chip;
  }
}

const SIDE_LINE = {
  left: Decoration.line({ class: 'cm-merge-left' }),
  right: Decoration.line({ class: 'cm-merge-right' }),
  both: Decoration.line({ class: 'cm-merge-both' }),
};

function decorate(state: EditorState, pendingLabel: (index: number) => string): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  state.field(mergeBlocks).forEach((block, index) => {
    if (!block.decided) {
      builder.add(block.from, block.from, Decoration.widget({ widget: new PendingWidget(index, pendingLabel(index)), block: true, side: -1 }));
      return;
    }
    if (block.to <= block.from) return;
    const line = block.left && block.right ? SIDE_LINE.both : block.left ? SIDE_LINE.left : block.right ? SIDE_LINE.right : null;
    if (!line) return;
    for (let position = block.from; position < block.to; ) {
      const current = state.doc.lineAt(position);
      builder.add(current.from, current.from, line);
      position = current.to + 1;
    }
  });
  return builder.finish();
}

export function mergeResult(blocks: MergeBlock[], pendingLabel: (index: number) => string): Extension {
  return [mergeBlocks.init(() => blocks), EditorView.decorations.compute([mergeBlocks], (state) => decorate(state, pendingLabel))];
}
