import { enA } from './en.a.ts';
import { enB } from './en.b.ts';
import { enC, enPdf } from './en.c.ts';
import { enV11 } from './en.v11.ts';
import { enV12 } from './en.v12.ts';
import { enV13 } from './en.v13.ts';

/** Catalogue anglais : clé = texte français (voir `index.ts`). */
export const en: Record<string, string> = { ...enA, ...enB, ...enC, ...enPdf, ...enV11, ...enV12, ...enV13 };
