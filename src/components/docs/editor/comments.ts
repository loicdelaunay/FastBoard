import { StateEffect, StateField, type Text } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { findQuote, type DocCommentDTO } from '@shared/docComments';
import type { TextRange } from './commands';

/** Passages commentés dans l'éditeur : surlignés dans le source, et retrouvés quand le texte bouge autour d'eux. */

export const setDocComments = StateEffect.define<readonly DocCommentDTO[]>();

export interface LocatedComment {
  comment: DocCommentDTO;
  range: TextRange;
}

interface CommentsValue {
  comments: readonly DocCommentDTO[];
  located: LocatedComment[];
  decorations: DecorationSet;
}

function locate(doc: Text, comments: readonly DocCommentDTO[]): Omit<CommentsValue, 'comments'> {
  const text = doc.toString();
  const located = comments.flatMap((comment) => {
    const range = comment.quote && !comment.resolvedAt ? findQuote(text, comment, true) : null;
    return range ? [{ comment, range }] : [];
  });
  return {
    located,
    decorations: Decoration.set(
      located.filter(({ range }) => range.from < range.to).map(({ comment, range }) => Decoration.mark({ class: 'cm-doc-comment', attributes: { 'data-comment': String(comment.id) } }).range(range.from, range.to)),
      true,
    ),
  };
}

export const docComments = StateField.define<CommentsValue>({
  create: (state) => ({ comments: [], ...locate(state.doc, []) }),
  update(value, transaction) {
    const effect = transaction.effects.find((entry) => entry.is(setDocComments));
    if (!effect && !transaction.docChanged) return value;
    const comments = effect ? (effect.value as readonly DocCommentDTO[]) : value.comments;
    return { comments, ...locate(transaction.newDoc, comments) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});
