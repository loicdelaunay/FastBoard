import { enA } from './en.a.ts';
import { enB } from './en.b.ts';
import { enC, enPdf } from './en.c.ts';

/** Catalogue anglais : clé = texte français (voir `index.ts`). */
export const en: Record<string, string> = { ...enA, ...enB, ...enC, ...enPdf };
