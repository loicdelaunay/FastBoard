import { pickedCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import { t } from '@/i18n';

/** Couleurs de surlignage proposées après « == » : la bille donne sa couleur au surlignage (`==🟢 Validé==`). */
const CHOICES: Array<{ emoji: string; label: string; keywords: string }> = [
  { emoji: '🟢', label: 'Vert', keywords: 'green valide ok fait' },
  { emoji: '🟡', label: 'Jaune', keywords: 'yellow attention' },
  { emoji: '🟠', label: 'Orange', keywords: 'orange risque' },
  { emoji: '🔴', label: 'Rouge', keywords: 'red bloque erreur' },
  { emoji: '🔵', label: 'Bleu', keywords: 'blue info' },
  { emoji: '🟣', label: 'Violet', keywords: 'purple' },
  { emoji: '🟤', label: 'Marron', keywords: 'brown' },
  { emoji: '⚫', label: 'Gris', keywords: 'black gray grey noir' },
  { emoji: '⚪', label: 'Blanc', keywords: 'white' },
];

/** Pas de surlignage dans du code. */
const CODE = /^(InlineCode|CodeText|FencedCode|CodeBlock|CodeMark)$/;

/**
 * Autocomplétion des surlignages colorés : « == » ouvrant (début de ligne ou après une espace) propose les billes ;
 * la choisir l'insère, avec les « == » de fin s'ils manquent sur la ligne.
 */
export function highlightColors(enabled: () => boolean) {
  return (context: CompletionContext): CompletionResult | null => {
    if (!enabled()) return null;
    const match = context.matchBefore(/(?:^|[\s([*_])==\p{L}*$/u);
    if (!match) return null;
    const start = match.from + match.text.indexOf('==') + 2;
    for (let node: { name: string; parent: unknown } | null = syntaxTree(context.state).resolveInner(context.pos, -1); node; node = node.parent as typeof node) {
      if (CODE.test(node.name)) return null;
    }
    const options = CHOICES.map(
      (choice, index): Completion => ({
        label: `${t(choice.label)} ${choice.keywords}`,
        displayLabel: `${choice.emoji} ${t(choice.label)}`,
        type: 'highlight',
        boost: -index,
        apply: (view: EditorView, completion: Completion, from: number, to: number) => {
          const line = view.state.doc.lineAt(to);
          const closed = view.state.sliceDoc(to, line.to).includes('==');
          const insert = `${choice.emoji} ${closed ? '' : '=='}`;
          view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + choice.emoji.length + 1 }, annotations: pickedCompletion.of(completion) });
        },
      }),
    );
    return { from: start, options, validFor: /^\p{L}*$/u };
  };
}
