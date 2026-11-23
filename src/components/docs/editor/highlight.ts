import { HighlightStyle, type TagStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/**
 * Couleurs du Markdown dans l'éditeur, lisibles sur fond clair comme sur fond noir : tout passe par les variables du
 * thème (le style par défaut de CodeMirror, bleu nuit et rouge foncé, disparaît sur un fond sombre).
 *
 * La citation vient avant le gras, l'italique, les liens et le code : à égalité de spécificité, la dernière règle
 * l'emporte, et ce qui est écrit dans une citation garde ainsi sa propre couleur, comme en lecture.
 */
function styles(live: boolean): TagStyle[] {
  return [
    { tag: tags.heading1, fontWeight: '700', color: 'var(--md-h1, var(--md-text, var(--fb-text)))' },
    { tag: tags.heading2, fontWeight: '700', color: 'var(--md-h2, var(--md-text, var(--fb-text)))' },
    { tag: tags.heading3, fontWeight: '700', color: 'var(--md-h3, var(--md-text, var(--fb-text)))' },
    { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: '700', color: 'var(--md-h4, var(--md-text, var(--fb-text)))' },
    { tag: tags.heading, fontWeight: '700', color: 'var(--md-text, var(--fb-text))' },
    // En « Lecture et écriture », la citation s'affiche comme en lecture : couleur du thème, sans italique.
    { tag: tags.quote, color: 'var(--md-quote, var(--fb-muted))', ...(live ? {} : { fontStyle: 'italic' }) },
    { tag: tags.emphasis, fontStyle: 'italic', color: 'var(--md-em, currentColor)' },
    { tag: tags.strong, fontWeight: '700', color: 'var(--md-strong, currentColor)' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
    { tag: [tags.link, tags.url], color: 'var(--md-link, var(--fb-accent))' },
    { tag: tags.labelName, color: 'var(--fb-accent)' },
    { tag: [tags.string, tags.special(tags.string)], color: 'var(--fb-hl-string)' },
    // Dans le source, le code se repère à sa couleur ; rendu, il garde celle du texte, comme en lecture.
    { tag: tags.monospace, color: live ? 'var(--md-code, var(--fb-md-code))' : 'var(--md-code, var(--fb-hl-code))' },
    { tag: [tags.processingInstruction, tags.contentSeparator, tags.meta], color: 'var(--fb-muted)' },
    { tag: [tags.comment, tags.blockComment, tags.lineComment], color: 'var(--fb-muted)', fontStyle: 'italic' },
    { tag: [tags.keyword, tags.operatorKeyword, tags.controlKeyword], color: 'var(--fb-hl-keyword)' },
    { tag: [tags.number, tags.bool, tags.atom], color: 'var(--fb-hl-number)' },
    { tag: [tags.typeName, tags.className, tags.tagName], color: 'var(--fb-hl-type)' },
    { tag: [tags.propertyName, tags.attributeName], color: 'var(--fb-hl-property)' },
    { tag: tags.invalid, color: 'var(--fb-danger)' },
  ];
}

/** Source Markdown (« Écriture », comparateur). */
export const docHighlight = HighlightStyle.define(styles(false));

/** « Lecture et écriture » : le texte rendu suit le thème comme la lecture. */
export const docLiveHighlight = HighlightStyle.define(styles(true));
