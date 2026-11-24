import type { Db } from '../db/database.ts';
import { APP_ICON_SIZES, appInfo, type AppIconName } from './appSettings.ts';

/**
 * Manifeste de l'application installable (PWA) : nom et icônes de l'image de marque, raccourcis vers les modules
 * activés. Public (le navigateur le lit sans session) ; en anglais quand le navigateur le préfère.
 */

const TEXTS = {
  fr: {
    description: 'Projets, documentation et tableaux blancs, en temps réel.',
    projects: 'Projets',
    docs: 'Documentations',
    boards: 'Tableaux blancs',
    search: 'Rechercher',
    assistant: 'Assistant IA',
  },
  en: {
    description: 'Projects, documentation and whiteboards, in real time.',
    projects: 'Projects',
    docs: 'Documentation',
    boards: 'Whiteboards',
    search: 'Search',
    assistant: 'AI assistant',
  },
} as const;

/** Langue du manifeste d'après l'en-tête `Accept-Language` : le français par défaut, l'anglais s'il passe avant. */
export function manifestLanguage(header: string | undefined): 'fr' | 'en' {
  const wanted = (header ?? '')
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().toLowerCase().split(';');
      const q = Number(params.find((param) => param.trim().startsWith('q='))?.trim().slice(2) ?? 1);
      return { tag, q: Number.isFinite(q) ? q : 0 };
    })
    .filter((entry) => entry.tag.startsWith('fr') || entry.tag.startsWith('en'))
    .sort((a, b) => b.q - a.q)[0];
  return wanted?.tag.startsWith('en') ? 'en' : 'fr';
}

/** Icônes : celles tirées du logo s'il y en a, sinon celles par défaut. */
function icons(iconsVersion: number): Array<Record<string, string>> {
  const url = (name: AppIconName): string => (iconsVersion ? `/api/app/icons/${name}.png?v=${iconsVersion}` : `/icons/${name}.png`);
  const size = (name: AppIconName): string => `${APP_ICON_SIZES[name]}x${APP_ICON_SIZES[name]}`;
  return [
    { src: url('icon-192'), sizes: size('icon-192'), type: 'image/png', purpose: 'any' },
    { src: url('icon-512'), sizes: size('icon-512'), type: 'image/png', purpose: 'any' },
    { src: url('maskable-192'), sizes: size('maskable-192'), type: 'image/png', purpose: 'maskable' },
    { src: url('maskable-512'), sizes: size('maskable-512'), type: 'image/png', purpose: 'maskable' },
  ];
}

export function webManifest(db: Db, language: 'fr' | 'en'): Record<string, unknown> {
  const info = appInfo(db);
  const text = TEXTS[language];
  const shortcut = (name: string, url: string) => ({ name, short_name: name, url, icons: [{ src: info.iconsVersion ? `/api/app/icons/icon-192.png?v=${info.iconsVersion}` : '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] });
  return {
    id: '/',
    name: info.name,
    short_name: info.name.length > 15 ? info.name.slice(0, 15).trim() : info.name,
    description: text.description,
    lang: language,
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'any',
    background_color: '#f8fafc',
    theme_color: '#4f46e5',
    categories: ['productivity', 'business'],
    prefer_related_applications: false,
    icons: icons(info.iconsVersion),
    shortcuts: [
      shortcut(text.projects, '/'),
      ...(info.docs ? [shortcut(text.docs, '/documentation')] : []),
      ...(info.boards ? [shortcut(text.boards, '/tableaux')] : []),
      shortcut(text.search, '/search'),
      ...(info.ai ? [shortcut(text.assistant, '/assistant')] : []),
    ],
  };
}
