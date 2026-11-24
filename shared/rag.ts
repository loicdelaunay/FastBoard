/**
 * RAG (recherche sémantique) : un modèle d'embeddings compatible OpenAI (`POST {baseUrl}/embeddings`) transforme les
 * tickets, les notes et les tableaux blancs des projets et espaces où on l'a activé en vecteurs, réindexés
 * périodiquement ; l'assistant IA y cherche par le sens, dans les seuls projets et espaces de la personne.
 */

/** Ce qui s'indexe : les tickets d'un projet, les notes d'un espace de documentation, les tableaux d'un espace. */
export const RAG_SCOPES = ['project', 'docs', 'boards'] as const;
export type RagScope = (typeof RAG_SCOPES)[number];

/** Nature d'un passage indexé. */
export const RAG_KINDS = ['ticket', 'doc', 'board'] as const;
export type RagKind = (typeof RAG_KINDS)[number];

export const RAG_SCOPE_OF: Record<RagKind, RagScope> = { ticket: 'project', doc: 'docs', board: 'boards' };

/**
 * Mise en forme des textes avant le calcul des vecteurs. Les modèles d'embeddings récents sont entraînés avec une
 * consigne différente pour une question et pour un document ; sans elle, la recherche perd en qualité sans erreur.
 * `auto` : d'après le nom du modèle ; `custom` : les gabarits saisis (`{text}`, et `{title}` pour un document).
 */
export const RAG_FORMATS = ['auto', 'none', 'embeddinggemma', 'nomic', 'qwen3', 'custom'] as const;
export type RagFormat = (typeof RAG_FORMATS)[number];
export type RagPreset = Exclude<RagFormat, 'auto' | 'custom'>;

export interface RagTemplates {
  /** Gabarit d'une question (`{text}`). */
  query: string;
  /** Gabarit d'un passage indexé (`{text}`, `{title}`). */
  document: string;
}

/** Consigne de Qwen3 Embedding pour une question (en anglais, comme le recommande le modèle). */
export const QWEN3_TASK = 'Given a question, retrieve passages from project tickets, notes and whiteboards that answer it';

export const RAG_PRESETS: Record<RagPreset, RagTemplates & { label: string }> = {
  none: { label: 'Aucune mise en forme', query: '{text}', document: '{text}' },
  // EmbeddingGemma et EmbeddingGemma 2 : « task: search result | query: » et « title: … | text: » (titre « none » à défaut).
  embeddinggemma: { label: 'EmbeddingGemma', query: 'task: search result | query: {text}', document: 'title: {title} | text: {text}' },
  // Nomic Embed Text (v1, v1.5, v2) : un préfixe de tâche des deux côtés.
  nomic: { label: 'Nomic Embed', query: 'search_query: {text}', document: 'search_document: {text}' },
  // Qwen3 Embedding : une consigne pour la question, le document tel quel.
  qwen3: { label: 'Qwen3 Embedding', query: `Instruct: ${QWEN3_TASK}\nQuery:{text}`, document: '{text}' },
};

/** Famille d'un modèle d'après son nom (`embeddinggemma:300m`, `nomic-embed-text`, `Qwen/Qwen3-Embedding-0.6B`…). */
export function detectRagPreset(model: string): RagPreset {
  const name = model.toLowerCase();
  if (/embedding-?gemma/.test(name)) return 'embeddinggemma';
  if (/nomic/.test(name)) return 'nomic';
  if (/qwen-?3.*embed/.test(name)) return 'qwen3';
  return 'none';
}

/** Gabarits en vigueur pour ces réglages. */
export function ragTemplates(settings: { format: RagFormat; model: string; queryTemplate: string; documentTemplate: string }): RagTemplates {
  if (settings.format === 'custom') return { query: settings.queryTemplate || '{text}', document: settings.documentTemplate || '{text}' };
  const preset = settings.format === 'auto' ? detectRagPreset(settings.model) : settings.format;
  const { query, document } = RAG_PRESETS[preset];
  return { query, document };
}

/** Applique un gabarit ; sans `{text}`, le texte suit le gabarit (un simple préfixe). */
export function applyRagTemplate(template: string, text: string, title = ''): string {
  const filled = template.replaceAll('{title}', title.trim() || 'none');
  return filled.includes('{text}') ? filled.replaceAll('{text}', text) : `${filled}${text}`;
}

export const RAG_LIMITS = {
  intervalHoursMin: 1,
  intervalHoursMax: 24 * 60,
  intervalHoursDefault: 24,
  /** Taille visée d'un passage (en caractères). */
  chunkChars: 1_200,
  chunkCharsMin: 300,
  chunkCharsMax: 6_000,
  /** Textes envoyés par requête d'embeddings. */
  batch: 16,
  timeoutSeconds: 60,
  timeoutMax: 600,
  dimensionsMax: 8_192,
  templateMax: 500,
  resultsDefault: 8,
  resultsMax: 20,
  /** Éléments d'un tableau rattachés à un passage (pour les citer). */
  elementsPerChunk: 30,
  /** Texte d'un ticket indexé (titre, description, commentaires). */
  ticketChars: 40_000,
} as const;

export interface RagSettingsDTO {
  enabled: boolean;
  baseUrl: string;
  hasKey: boolean;
  keyHint: string | null;
  verifyCertificate: boolean;
  timeoutSeconds: number;
  model: string;
  format: RagFormat;
  queryTemplate: string;
  documentTemplate: string;
  /** Vecteurs tronqués à cette taille (modèles « Matryoshka ») ; `null` : taille du modèle. */
  dimensions: number | null;
  intervalHours: number;
  chunkChars: number;
  updatedAt: string | null;
}

export interface RagScopeCountDTO {
  scope: RagScope;
  /** Projets ou espaces où le RAG est activé. */
  enabled: number;
  /** Éléments indexés (tickets, notes, tableaux) et passages. */
  sources: number;
  chunks: number;
}

export interface RagStatusDTO {
  running: boolean;
  /** Progression de l'indexation en cours. */
  progress: { done: number; total: number } | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastDurationMs: number | null;
  nextRunAt: string | null;
  /** Taille des vecteurs de l'index. */
  dimensions: number | null;
  /** Réglages changés depuis la dernière indexation : l'index sera reconstruit. */
  stale: boolean;
  scopes: RagScopeCountDTO[];
}

export interface RagTestResultDTO {
  ok: boolean;
  message: string;
  model: string;
  format: RagPreset | 'custom';
  dimensions: number | null;
  ms: number | null;
  /** Similarité de la question d'essai avec un passage qui y répond, puis avec un passage sans rapport. */
  related: number | null;
  unrelated: number | null;
}

/** Passage trouvé par la recherche sémantique. */
export interface RagHitDTO {
  kind: RagKind;
  id: number;
  title: string;
  /** Projet d'un ticket, espace d'une note ou d'un tableau. */
  containerId: number;
  score: number;
  excerpt: string;
  /** Lignes du passage dans la note (`12-18`). */
  lines?: string;
  /** Éléments du tableau dans ce passage. */
  elements?: string[];
}
