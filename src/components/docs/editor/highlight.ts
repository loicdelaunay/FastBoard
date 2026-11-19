import { HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/**
 * Couleurs du source Markdown, lisibles sur fond clair comme sur fond noir : tout passe par les variables du thème
 * (le style par défaut de CodeMirror, bleu nuit et rouge foncé, disparaît sur un fond sombre).
 */
export const docHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: '700', color: 'var(--md-h1, var(--md-text, var(--fb-text)))' },
  { tag: tags.heading2, fontWeight: '700', color: 'var(--md-h2, var(--md-text, var(--fb-text)))' },
  { tag: tags.heading3, fontWeight: '700', color: 'var(--md-h3, var(--md-text, var(--fb-text)))' },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: '700', color: 'var(--md-h4, var(--md-text, var(--fb-text)))' },
  { tag: tags.heading, fontWeight: '700', color: 'var(--md-text, var(--fb-text))' },
  { tag: tags.emphasis, fontStyle: 'italic', color: 'var(--md-em, currentColor)' },
  { tag: tags.strong, fontWeight: '700', color: 'var(--md-strong, currentColor)' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: 'var(--md-link, var(--fb-accent))' },
  { tag: tags.labelName, color: 'var(--fb-accent)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--fb-hl-string)' },
  { tag: tags.monospace, color: 'var(--md-code, var(--fb-hl-code))' },
  { tag: tags.quote, color: 'var(--md-quote, var(--fb-muted))', fontStyle: 'italic' },
  { tag: [tags.processingInstruction, tags.contentSeparator, tags.meta], color: 'var(--fb-muted)' },
  { tag: [tags.comment, tags.blockComment, tags.lineComment], color: 'var(--fb-muted)', fontStyle: 'italic' },
  { tag: [tags.keyword, tags.operatorKeyword, tags.controlKeyword], color: 'var(--fb-hl-keyword)' },
  { tag: [tags.number, tags.bool, tags.atom], color: 'var(--fb-hl-number)' },
  { tag: [tags.typeName, tags.className, tags.tagName], color: 'var(--fb-hl-type)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--fb-hl-property)' },
  { tag: tags.invalid, color: 'var(--fb-danger)' },
]);
