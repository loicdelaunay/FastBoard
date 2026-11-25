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

/** Nom affiché du langage d'un bloc (`Python`, `Shell`…), ou ce qui est écrit s'il est inconnu. */
export function codeLanguageLabel(name: string): string {
  return codeLanguage(name)?.name ?? name.trim();
}

/** Nom à écrire après ``` pour un langage : lisible, et reconnu par la coloration. */
function fenceName(description: LanguageDescription): string {
  const lower = description.name.toLowerCase();
  if (!/\s/.test(lower)) return lower;
  return description.alias.find((alias) => !/\s/.test(alias)) ?? lower.replace(/\s+/g, '');
}

export interface CodeLanguageOption {
  /** Écrit après ``` (vide : texte brut). */
  value: string;
  label: string;
  /** Autres noms, pour la recherche (`py`, `sh`…). */
  aliases: readonly string[];
}

/** Langages proposés pour un bloc de code, par ordre alphabétique. */
export function codeLanguageOptions(): CodeLanguageOption[] {
  return languages
    .map((description) => ({ value: fenceName(description), label: description.name, aliases: [...description.alias, ...description.extensions] }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
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
