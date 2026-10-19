import { intlLocale, t } from '@/i18n';
import { isInlineImage } from '@shared/attachments';
import type { AttachmentDTO } from '@shared/types';

/** « 1,4 Mo », « 320 Ko »… */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} ${t('o')}`;
  }
  const units = [t('Ko'), t('Mo'), t('Go')];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toLocaleString(intlLocale(), { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}

/** Adresse de téléchargement ; `inline` affiche l'image dans la page (vignette, aperçu). */
export function attachmentUrl(attachment: Pick<AttachmentDTO, 'id'>, inline = false): string {
  return `/api/attachments/${attachment.id}/download${inline ? '?inline=1' : ''}`;
}

export function isImageAttachment(attachment: Pick<AttachmentDTO, 'mime'>): boolean {
  return isInlineImage(attachment.mime);
}

/** Icône PrimeIcons d'un fichier non image, d'après son type puis son extension. */
export function fileIcon(attachment: Pick<AttachmentDTO, 'mime' | 'name'>): string {
  const extension = attachment.name.split('.').pop()?.toLowerCase() ?? '';
  if (attachment.mime === 'application/pdf' || extension === 'pdf') return 'pi pi-file-pdf';
  if (['xls', 'xlsx', 'ods', 'csv'].includes(extension)) return 'pi pi-file-excel';
  if (['doc', 'docx', 'odt', 'rtf'].includes(extension)) return 'pi pi-file-word';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'tgz'].includes(extension)) return 'pi pi-box';
  if (attachment.mime.startsWith('video/')) return 'pi pi-video';
  if (attachment.mime.startsWith('audio/')) return 'pi pi-volume-up';
  if (attachment.mime.startsWith('image/')) return 'pi pi-image';
  return 'pi pi-file';
}
