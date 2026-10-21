/** Assistant IA : réglages (fournisseur compatible OpenAI v1) et protocole du panneau de discussion. */

export const DEFAULT_AI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_AI_MODEL = 'gpt-4o-mini';
export const DEFAULT_CONTEXT_WINDOW = 128_000;

/** Niveaux de réflexion proposés aux modèles qui en ont (paramètre `reasoning_effort`). */
export const REASONING_LEVELS = ['minimal', 'low', 'medium', 'high'] as const;
export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

/** Un modèle mis à disposition par l'administrateur, avec ses capacités. */
export interface AiModelDTO {
  id: string;
  /** Nom affiché (facultatif ; sinon l'identifiant). */
  label: string;
  /** Le modèle comprend les images (on peut lui en joindre). */
  vision: boolean;
  /** Taille du contexte en jetons : la conversation et les résultats d'outils sont réduits pour y tenir. */
  contextWindow: number;
  /** Le modèle accepte un niveau de réflexion (`reasoning_effort`). */
  reasoning: boolean;
}

export interface AiSettingsDTO {
  enabled: boolean;
  /** URL de base d'une API compatible OpenAI v1 (OpenAI, Azure OpenAI, Mistral, DeepSeek, Ollama, LM Studio…). */
  baseUrl: string;
  models: AiModelDTO[];
  defaultModel: string;
  /** Une clé est enregistrée (elle n'est jamais renvoyée). */
  hasKey: boolean;
  /** Quatre derniers caractères de la clé, pour la reconnaître. */
  keyHint: string | null;
  updatedAt: string | null;
}

/** Modèle trouvé chez le fournisseur (`GET /models`), avec des capacités devinées d'après son nom. */
export interface DetectedModelDTO extends AiModelDTO {
  ownedBy: string | null;
}

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Images jointes (URL `data:image/…;base64,…`), envoyées seulement aux modèles avec vision. */
  images?: string[];
}

/** Contexte ouvert dans l'interface : le projet et, le cas échéant, le ticket affichés. */
export interface AiContext {
  projectId?: number | null;
  ticketId?: number | null;
}

export interface AiChatRequest {
  messages: AiMessage[];
  context: AiContext;
  /** Autorise l'assistant à modifier (si la personne en a le droit). */
  allowWrite: boolean;
  /** Modèle choisi dans le panneau (parmi ceux mis à disposition) ; absent = modèle par défaut. */
  model?: string;
  /** Niveau de réflexion (modèles qui le gèrent) ; absent = réglage du fournisseur. */
  reasoning?: ReasoningLevel;
}

/** Évènements envoyés pendant une réponse (flux `text/event-stream`). */
export type AiStreamEvent =
  /** Modèle effectivement utilisé. */
  | { type: 'model'; model: string; label: string }
  /** L'assistant utilise un outil (recherche, lecture, modification…). */
  | { type: 'step'; id: string; tool: string; label: string; status: 'running' | 'done' | 'failed'; detail?: string; write: boolean }
  /** Réponse finale (Markdown). */
  | { type: 'message'; content: string }
  | { type: 'error'; message: string }
  | { type: 'done'; changes: number };

export const AI_LIMITS = {
  messages: 40,
  messageChars: 12_000,
  /** Allers-retours maximum entre le modèle et les outils pour une question. */
  steps: 10,
  imagesPerMessage: 4,
  /** Taille maximale d'une image jointe (URL data, en caractères). */
  imageChars: 3_000_000,
  models: 50,
};

/** Capacités probables d'un modèle d'après son nom (à vérifier par l'administrateur). */
export function guessCapabilities(id: string): Pick<AiModelDTO, 'vision' | 'reasoning' | 'contextWindow'> {
  const name = id.toLowerCase();
  const vision = /gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-5|o3|o4|vision|-vl|vl-|llava|pixtral|gemini|claude|qwen.*vl|gemma-3|llama-?3\.2.*vision|mistral-(small|medium)-(2503|2505|latest)|grok-.*vision/.test(name);
  const reasoning = /(^|[^a-z])o[1345](-|$)|gpt-5|reasoner|-r1|deepseek-r|thinking|qwq|magistral|grok-3-mini|grok-4/.test(name);
  const contextWindow = /gpt-4\.1|gemini/.test(name) ? 1_000_000 : /gpt-5|o3|o4/.test(name) ? 200_000 : /gpt-3\.5/.test(name) ? 16_000 : /llama|mistral|qwen|gemma|phi/.test(name) ? 32_000 : DEFAULT_CONTEXT_WINDOW;
  return { vision, reasoning, contextWindow };
}
