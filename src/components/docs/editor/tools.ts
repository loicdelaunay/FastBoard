import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { pickedCompletion } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import { t } from '@/i18n';
import { CURSOR, insertBlock, insertText, setLinePrefix, wrapSelection, type TextRange } from './commands';

/** Outils d'écriture, partagés par la barre d'outils, le menu du clic droit et les commandes « / ». */

export interface DocTool {
  label: string;
  icon: string;
  /** Mots qui la retrouvent aussi après « / ». */
  keywords?: string;
  /** Raccourci affiché dans l'infobulle. */
  shortcut?: string;
  run: (view: EditorView, range?: TextRange) => void;
}

export interface ToolHandlers {
  pickImage: () => void;
}

export function inlineTools(): DocTool[] {
  return [
    { label: t('Gras'), icon: 'fb-glyph-bold', shortcut: 'Ctrl+B', run: (view, range) => wrapSelection(view, '**', '**', t('texte'), range) },
    { label: t('Italique'), icon: 'fb-glyph-italic', shortcut: 'Ctrl+I', run: (view, range) => wrapSelection(view, '_', '_', t('texte'), range) },
    { label: t('Barré'), icon: 'pi pi-minus', run: (view, range) => wrapSelection(view, '~~', '~~', t('texte'), range) },
    { label: t('Code'), icon: 'pi pi-code', run: (view, range) => wrapSelection(view, '`', '`', 'code', range) },
    { label: t('Lien'), icon: 'pi pi-link', shortcut: 'Ctrl+K', keywords: 'url link', run: (view, range) => wrapSelection(view, '[', '](https://)', t('texte du lien'), range) },
  ];
}

export function lineTools(): DocTool[] {
  const prefix = (text: string | ((index: number) => string)) => (view: EditorView, range?: TextRange) => setLinePrefix(view, text, range);
  return [
    { label: t('Paragraphe'), icon: 'pi pi-align-left', keywords: 'texte text', run: prefix('') },
    { label: t('Titre 1'), icon: 'pi pi-hashtag', keywords: 'h1 heading', run: prefix('# ') },
    { label: t('Titre 2'), icon: 'pi pi-hashtag', keywords: 'h2 heading', run: prefix('## ') },
    { label: t('Titre 3'), icon: 'pi pi-hashtag', keywords: 'h3 heading', run: prefix('### ') },
    { label: t('Liste à puces'), icon: 'pi pi-list', keywords: 'ul bullet', run: prefix('- ') },
    { label: t('Liste numérotée'), icon: 'pi pi-sort-numeric-down', keywords: 'ol numbered', run: prefix((index) => `${index + 1}. `) },
    { label: t('Liste de tâches'), icon: 'pi pi-check-square', keywords: 'todo case task', run: prefix('- [ ] ') },
    { label: t('Citation'), icon: 'pi pi-comment', keywords: 'quote', run: prefix('> ') },
  ];
}

export function insertTools(handlers: ToolHandlers): DocTool[] {
  const block = (template: () => string) => (view: EditorView, range?: TextRange) => insertBlock(view, template(), range && { from: range.to, to: range.to });
  return [
    { label: t('Tableau'), icon: 'pi pi-table', keywords: 'table', run: block(() => `| ${t('Colonne')} 1 | ${t('Colonne')} 2 |\n| --- | --- |\n| ${CURSOR} |  |`) },
    { label: t('Bloc de code'), icon: 'pi pi-book', keywords: 'code', run: block(() => `\`\`\`\n${CURSOR}\n\`\`\``) },
    { label: t('Diagramme Mermaid'), icon: 'pi pi-sitemap', keywords: 'graph schema', run: block(() => `\`\`\`mermaid\nflowchart LR\n  A[${CURSOR}Début] --> B[Fin]\n\`\`\``) },
    { label: t('Formule (LaTeX)'), icon: 'pi pi-calculator', keywords: 'math equation', run: block(() => `$$\n${CURSOR}\n$$`) },
    { label: t('Séparateur'), icon: 'pi pi-minus', keywords: 'hr ligne divider', run: block(() => `---\n${CURSOR}`) },
    { label: t('Image'), icon: 'pi pi-image', keywords: 'photo picture', run: () => handlers.pickImage() },
    { label: t('Lien vers une note'), icon: 'pi pi-file', keywords: 'wiki note', run: (view) => insertText(view, '[[') },
    { label: t('Date du jour'), icon: 'pi pi-calendar', keywords: 'date today', run: (view) => insertText(view, new Date().toLocaleDateString()) },
  ];
}

interface SlashCompletion extends Completion {
  icon: string;
}

/** Commandes « / » : taper le début d'un nom filtre la liste, Entrée la remplace par l'élément. */
export function slashCommands(handlers: ToolHandlers) {
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(/(?:^|[\s(])\/[\p{L}\d]*/u);
    if (!match) return null;
    const slash = match.from + match.text.indexOf('/');
    const options = [...lineTools(), ...insertTools(handlers)].map(
      (tool, index): SlashCompletion => ({
        label: `${tool.label} ${tool.keywords ?? ''}`.trim(),
        displayLabel: tool.label,
        icon: tool.icon,
        boost: -index,
        apply: (view, completion, from, to) => {
          view.dispatch({ changes: { from: from - 1, to }, annotations: pickedCompletion.of(completion) });
          tool.run(view);
        },
      }),
    );
    return { from: slash + 1, options, validFor: /^[\p{L}\d]*$/u };
  };
}

/** Icône d'une ligne de la liste de complétion (commandes « / » uniquement). */
export function completionIcon(completion: Completion): HTMLElement | null {
  const { icon } = completion as Partial<SlashCompletion>;
  if (!icon) return null;
  const element = document.createElement('i');
  element.className = `${icon} cm-slash-icon`;
  return element;
}
