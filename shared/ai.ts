/** Assistant IA : réglages (fournisseurs compatibles OpenAI v1) et protocole du panneau de discussion. */

import type { TicketStatus } from './constants.ts';

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

/** Un fournisseur compatible OpenAI v1 (OpenAI, Azure OpenAI, Mistral, DeepSeek, Ollama, LM Studio…) et ses modèles. */
export interface AiProviderDTO {
  /** Identifiant stable (lettres et chiffres), préfixe des références de modèle. */
  id: string;
  name: string;
  baseUrl: string;
  /** Délai maximal d'une réponse du fournisseur, en secondes. */
  timeoutSeconds: number;
  models: AiModelDTO[];
  /** Une clé est enregistrée (elle n'est jamais renvoyée). */
  hasKey: boolean;
  /** Quatre derniers caractères de la clé, pour la reconnaître. */
  keyHint: string | null;
}

export interface AiSettingsDTO {
  enabled: boolean;
  providers: AiProviderDTO[];
  /** Référence du modèle par défaut (`fournisseur:modèle`, voir `modelRef`). */
  defaultModel: string;
  /** Allers-retours maximum entre le modèle et les outils pour une question (« tours de réflexion »). */
  maxSteps: number;
  /** Échanges précédents (question + réponse) transmis au modèle (« tours de discussion »). */
  maxTurns: number;
  updatedAt: string | null;
}

/** Modèle proposé dans le panneau : référence unique, fournisseur et capacités. */
export interface AiModelChoiceDTO extends AiModelDTO {
  ref: string;
  provider: string;
}

/** Référence d'un modèle : identifiant du fournisseur, deux-points, identifiant du modèle (qui peut contenir « : » ou « / »). */
export function modelRef(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`;
}

export function parseModelRef(ref: string): { providerId: string; modelId: string } | null {
  const index = ref.indexOf(':');
  return index > 0 ? { providerId: ref.slice(0, index), modelId: ref.slice(index + 1) } : null;
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

/** `apply` : l'assistant modifie directement ; `propose` : il propose des modifications que la personne valide. */
export type AiWriteMode = 'apply' | 'propose';

export interface AiChatRequest {
  messages: AiMessage[];
  context: AiContext;
  /** Autorise l'assistant à modifier (si la personne en a le droit). */
  allowWrite: boolean;
  writeMode?: AiWriteMode;
  /** Modèle choisi dans le panneau (référence parmi ceux mis à disposition) ; absent = modèle par défaut. */
  model?: string;
  /** Niveau de réflexion (modèles qui le gèrent) ; absent = réglage du fournisseur. */
  reasoning?: ReasoningLevel;
}

/** Champs d'un ticket modifiables par l'assistant (identifiants déjà résolus). */
export interface AiTicketFields {
  title?: string;
  description?: string;
  status?: TicketStatus;
  priorityId?: number | null;
  categoryId?: number | null;
  deliveryId?: number | null;
  componentIds?: number[];
  assigneeIds?: number[];
  startDate?: string | null;
  endDate?: string | null;
  progress?: number;
  parentId?: number | null;
}

/** Ce qu'il faut rejouer pour appliquer (ou annuler) une modification de l'assistant, avec l'API habituelle. */
export type AiChangeAction =
  | { kind: 'ticket.create'; projectId: number; fields: AiTicketFields & { title: string }; ticketId: number | null }
  | { kind: 'ticket.update'; ticketId: number; before: AiTicketFields; after: AiTicketFields }
  | { kind: 'comment.create'; ticketId: number; body: string; commentId: number | null }
  | { kind: 'subtask.create'; ticketId: number; title: string; assigneeId: number | null; subtaskId: number | null }
  | { kind: 'subtask.update'; ticketId: number; subtaskId: number; before: { done?: boolean; title?: string }; after: { done?: boolean; title?: string } }
  | { kind: 'link.create'; ticketId: number; targetId: number; reason: string; linkId: number | null };

/** Une modification faite (ou proposée) par l'assistant, telle qu'affichée dans le panneau. */
export interface AiChangeDTO {
  id: string;
  /** Ex. « Modification de APP-12 ». */
  label: string;
  projectId: number;
  ticketKey: string | null;
  /** Différences lisibles (valeurs affichées, pas des identifiants). */
  diff: Array<{ field: string; from: string | null; to: string | null }>;
  /** `applied` : faite ; `pending` : proposée, à valider ; `reverted` : annulée ; `rejected` : proposition écartée. */
  state: 'applied' | 'pending' | 'reverted' | 'rejected';
  action: AiChangeAction;
}

/** Évènements envoyés pendant une réponse (flux `text/event-stream`). */
export type AiStreamEvent =
  /** Modèle effectivement utilisé. */
  | { type: 'model'; model: string; label: string }
  /** L'assistant utilise un outil (recherche, lecture, modification…). */
  | { type: 'step'; id: string; tool: string; label: string; status: 'running' | 'done' | 'failed'; detail?: string; write: boolean }
  /** Raisonnement renvoyé par le modèle (modèles « de réflexion » qui l'exposent). */
  | { type: 'thought'; id: string; text: string }
  /** Modification faite ou proposée. */
  | { type: 'change'; change: AiChangeDTO }
  /** Réponse finale (Markdown). */
  | { type: 'message'; content: string }
  | { type: 'error'; message: string }
  | { type: 'done'; changes: number };

export const AI_LIMITS = {
  /** Messages acceptés par requête (le serveur n'en garde ensuite que `maxTurns` échanges). */
  messages: 200,
  messageChars: 12_000,
  /** Valeurs par défaut et bornes des tours de réflexion et de discussion. */
  steps: 10,
  stepsMax: 50,
  turns: 20,
  turnsMax: 100,
  timeoutSeconds: 120,
  timeoutMax: 900,
  imagesPerMessage: 4,
  /** Taille maximale d'une image jointe (URL data, en caractères). */
  imageChars: 3_000_000,
  models: 50,
  providers: 10,
  /** Conversations gardées par personne. */
  conversations: 50,
  /** Taille maximale d'une conversation enregistrée (JSON, en caractères). */
  conversationChars: 2_000_000,
};

/** Une conversation enregistrée (les 50 dernières de chaque personne sont gardées). */
export interface AiConversationSummaryDTO {
  id: string;
  title: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AiConversationDTO extends AiConversationSummaryDTO {
  context: AiContext;
  /** Tours affichés dans le panneau (format propre à l'interface). */
  turns: unknown[];
}

/** Capacités probables d'un modèle d'après son nom (à vérifier par l'administrateur). */
export function guessCapabilities(id: string): Pick<AiModelDTO, 'vision' | 'reasoning' | 'contextWindow'> {
  const name = id.toLowerCase();
  const vision = /gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-5|o3|o4|vision|-vl|vl-|llava|pixtral|gemini|claude|qwen.*vl|gemma-3|llama-?3\.2.*vision|mistral-(small|medium)-(2503|2505|latest)|grok-.*vision/.test(name);
  const reasoning = /(^|[^a-z])o[1345](-|$)|gpt-5|reasoner|-r1|deepseek-r|thinking|qwq|magistral|grok-3-mini|grok-4/.test(name);
  const contextWindow = /gpt-4\.1|gemini/.test(name) ? 1_000_000 : /gpt-5|o3|o4/.test(name) ? 200_000 : /gpt-3\.5/.test(name) ? 16_000 : /llama|mistral|qwen|gemma|phi/.test(name) ? 32_000 : DEFAULT_CONTEXT_WINDOW;
  return { vision, reasoning, contextWindow };
}
