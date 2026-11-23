import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { classHighlighter, highlightCode } from '@lezer/highlight';

/**
 * Coloration syntaxique des blocs de code rendus (```python, ```sql…), avec les grammaires de CodeMirror : chaque langage
 * se charge à la demande, et les couleurs sont celles du thème (`--fb-hl-*`), comme dans l'éditeur.
 */

/** Langage d'un bloc d'après son nom (`python`, `js`, `bash`…) ou, à défaut, comme extension de fichier (`py`, `rs`, `kt`). */
export function codeLanguage(name: string): LanguageDescription | null {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;
  return LanguageDescription.matchLanguageName(languages, wanted, false) ?? LanguageDescription.matchFilename(languages, `code.${wanted}`) ?? null;
}

/** Colore les blocs de code d'un rendu qui ne le sont pas encore ; un langage inconnu laisse le bloc tel quel. */
export async function highlightCodeBlocks(root: ParentNode): Promise<void> {
  const blocks = [...root.querySelectorAll<HTMLElement>('pre.md-code > code[data-lang]:not([data-highlighted])')];
  for (const code of blocks) {
    code.dataset.highlighted = '1';
    const description = codeLanguage(code.dataset.lang ?? '');
    if (!description) continue;
    try {
      const support = description.support ?? (await description.load());
      const text = code.textContent ?? '';
      const tree = support.language.parser.parse(text);
      const fragment = document.createDocumentFragment();
      highlightCode(
        text,
        tree,
        classHighlighter,
        (value, classes) => {
          if (!classes) {
            fragment.append(value);
            return;
          }
          const span = document.createElement('span');
          span.className = classes;
          span.textContent = value;
          fragment.append(span);
        },
        () => fragment.append('\n'),
      );
      // Le rendu a pu changer pendant le chargement de la grammaire (un bloc pas encore affiché se colore quand même).
      if (code.textContent === text) {
        code.replaceChildren(fragment);
        code.classList.add('highlighted');
      }
    } catch {
      // Grammaire indisponible : le code reste lisible, sans couleurs.
    }
  }
}
