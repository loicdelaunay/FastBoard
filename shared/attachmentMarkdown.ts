/**
 * Pièces jointes citées dans le Markdown d'un ticket (description) : une image s'affiche à l'endroit choisi, un autre
 * fichier devient un lien de téléchargement. L'adresse ne dépend que de l'identifiant : une image remplacée garde sa
 * place dans le texte.
 */

/** Adresse d'une pièce jointe dans le texte ; `inline` : affichée dans la page (images). */
export const attachmentMarkdownUrl = (attachmentId: number, inline: boolean): string => `/api/attachments/${attachmentId}/download${inline ? '?inline=1' : ''}`;

/** Le texte d'un lien Markdown ne doit pas fermer ses crochets. */
const label = (text: string): string => text.replace(/[[\]\\]/g, '').replace(/\s+/g, ' ').trim();

/** `![schéma](/api/attachments/12/download?inline=1)` pour une image, `[devis.pdf](/api/attachments/13/download)` sinon. */
export function attachmentMarkdown(attachment: { id: number; name: string }, image: boolean): string {
  if (image) return `![${label(attachment.name.replace(/\.[^.]+$/, '')) || 'image'}](${attachmentMarkdownUrl(attachment.id, true)})`;
  return `[${label(attachment.name) || 'fichier'}](${attachmentMarkdownUrl(attachment.id, false)})`;
}

/** Identifiant de la pièce jointe d'une adresse du texte (`/api/attachments/12/download…`), ou `null`. */
export function attachmentIdOf(src: string): number | null {
  const match = /^\/api\/attachments\/(\d+)\/download(?:[?#]|$)/.exec(src);
  return match ? Number(match[1]) : null;
}

/** Captures collées (toutes nommées « image.png ») : datées pour les distinguer, `capture-20261126-143015.png`. */
export function pastedFileName(name: string, now: Date, index = 0, count = 1): string {
  if (!/^image\.(png|jpe?g|gif|webp)$/i.test(name)) return name;
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `capture-${stamp}${count > 1 ? `-${index + 1}` : ''}.${name.split('.').pop()}`;
}
