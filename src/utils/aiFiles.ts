import { AI_LIMITS, type AiFile } from '@shared/ai';
import { t } from '@/i18n';

/**
 * Fichiers joints au message de l'assistant IA : le texte est extrait ici, dans le navigateur (PDF avec PDF.js,
 * CSV et autres fichiers texte décodés en UTF-8, UTF-16 ou Windows-1252), puis envoyé au modèle avec la question.
 */

/** Résultat de la lecture : le fichier (texte extrait) et, pour un PDF scanné lu par un modèle avec vision, ses pages en images. */
export interface ReadFile {
  file: AiFile;
  images: string[];
}

/** Types proposés par le sélecteur de fichiers (tout fichier texte est aussi accepté s'il est glissé ou collé). */
export const AI_FILE_ACCEPT = '.pdf,.csv,.tsv,.txt,.md,.json,.xml,.yaml,.yml,.log,.html,.sql,text/*,application/pdf,application/json';

export const isPdf = (file: File): boolean => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
export const isImage = (file: File): boolean => file.type.startsWith('image/') && !/\.svg$/i.test(file.name);

/** Icône d'un fichier joint d'après son nom ou son type. */
export function fileIcon(file: Pick<AiFile, 'name' | 'type'>): string {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pi pi-file-pdf';
  if (/\.(csv|tsv)$/i.test(file.name) || /csv|tab-separated/.test(file.type)) return 'pi pi-table';
  return 'pi pi-file';
}

/** Détail affiché sous le nom : pages (PDF) ou lignes, et « tronqué ». */
export function fileInfo(file: AiFile): string {
  const size = file.pages ? t('{n} page|{n} pages', { n: file.pages }) : file.text ? t('{n} ligne|{n} lignes', { n: file.text.replace(/\n$/, '').split('\n').length }) : '';
  return [size, file.truncated ? t('tronqué') : ''].filter(Boolean).join(' · ');
}

function clip(text: string): { text: string; truncated: boolean } {
  return text.length > AI_LIMITS.fileChars ? { text: text.slice(0, AI_LIMITS.fileChars), truncated: true } : { text, truncated: false };
}

/** Texte d'un fichier, ou `null` s'il est binaire. Sans BOM et hors UTF-8 valide : Windows-1252 (exports d'Excel). */
function decodeText(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  if (bytes.subarray(0, 8192).includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

async function openPdf(data: ArrayBuffer) {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs.getDocument({ data });
}

type PdfDocument = Awaited<Awaited<ReturnType<typeof openPdf>>['promise']>;

/** Texte des pages, précédé de « [Page n] », jusqu'à la limite de caractères. */
async function pdfText(pdf: PdfDocument): Promise<{ text: string; letters: number }> {
  const pages: string[] = [];
  let length = 0;
  let letters = 0;
  for (let number = 1; number <= pdf.numPages && length < AI_LIMITS.fileChars; number += 1) {
    const page = await pdf.getPage(number);
    const content = await page.getTextContent();
    let line = '';
    const lines: string[] = [];
    for (const item of content.items) {
      if (!('str' in item)) continue;
      line += item.str;
      if (item.hasEOL) {
        lines.push(line.trimEnd());
        line = '';
      }
    }
    if (line) lines.push(line.trimEnd());
    const text = lines.join('\n').trim();
    letters += text.replace(/\s/g, '').length;
    pages.push(`[Page ${number}]\n${text}`);
    length += text.length;
    page.cleanup();
  }
  return { text: pages.join('\n\n'), letters };
}

/** Premières pages rendues en images JPEG (PDF scanné, pour un modèle avec vision). */
async function pdfImages(pdf: PdfDocument, count: number): Promise<string[]> {
  const images: string[] = [];
  for (let number = 1; number <= Math.min(pdf.numPages, count); number += 1) {
    const page = await pdf.getPage(number);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2, 1568 / Math.max(base.width, base.height)) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport }).promise;
    images.push(canvas.toDataURL('image/jpeg', 0.85));
    page.cleanup();
  }
  return images;
}

async function readPdf(file: File, imageSlots: number): Promise<ReadFile> {
  const task = await openPdf(await file.arrayBuffer());
  let pdf: PdfDocument;
  try {
    pdf = await task.promise;
  } catch (error) {
    void task.destroy();
    if ((error as Error).name === 'PasswordException') throw new Error(t('« {name} » est protégé par un mot de passe.', { name: file.name }));
    throw new Error(t('Impossible de lire le PDF « {name} ».', { name: file.name }));
  }
  try {
    const base = { name: file.name, type: 'application/pdf', pages: pdf.numPages };
    const { text, letters } = await pdfText(pdf);
    // Presque pas de texte : document scanné, lisible seulement en images.
    if (letters < 20 * Math.min(pdf.numPages, 3)) {
      if (imageSlots <= 0) {
        throw new Error(t('« {name} » ne contient pas de texte (document scanné ?) : choisissez un modèle avec vision pour le lire en images.', { name: file.name }));
      }
      const images = await pdfImages(pdf, imageSlots);
      const note = `(PDF sans texte, probablement scanné : ${images.length === pdf.numPages ? 'ses pages sont jointes' : `ses ${images.length} première(s) page(s) sur ${pdf.numPages} sont jointes`} en images.)`;
      return { file: { ...base, text: note, truncated: images.length < pdf.numPages }, images };
    }
    const clipped = clip(text);
    return { file: { ...base, text: clipped.text, truncated: clipped.truncated || text.length >= AI_LIMITS.fileChars }, images: [] };
  } finally {
    void task.destroy();
  }
}

/** Lit un fichier joint (hors images) : PDF ou fichier texte (CSV, TSV, JSON, Markdown, journaux…). */
export async function readForAi(file: File, imageSlots: number): Promise<ReadFile> {
  if (file.size > AI_LIMITS.fileBytes) {
    throw new Error(t('« {name} » dépasse {size} Mo.', { name: file.name, size: Math.round(AI_LIMITS.fileBytes / 1024 / 1024) }));
  }
  if (isPdf(file)) return readPdf(file, imageSlots);
  const text = decodeText(new Uint8Array(await file.arrayBuffer()));
  if (text === null) {
    throw new Error(t('« {name} » : format non pris en charge. Joignez un PDF, un CSV, un fichier texte ou une image (exportez les tableurs en CSV).', { name: file.name }));
  }
  const clipped = clip(text.replace(/\r\n?/g, '\n'));
  return { file: { name: file.name, type: file.type, text: clipped.text, truncated: clipped.truncated }, images: [] };
}
