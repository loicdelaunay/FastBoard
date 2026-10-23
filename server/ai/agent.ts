import { randomUUID } from 'node:crypto';
import { AI_LIMITS, type AiChatRequest, type AiModelDTO, type AiStreamEvent } from '../../shared/ai.ts';
import { todayISO } from '../../shared/dates.ts';
import type { Actor, AppContext } from '../context.ts';
import type { AuthUser } from '../services/access.ts';
import { resolveProjectAccess } from '../services/access.ts';
import { getBranding } from '../services/appSettings.ts';
import { ticketKeyOf } from '../services/tickets.ts';
import { aiConfig, resolveModel, type AiEndpoint } from './settings.ts';
import { availableTools, runTool, toolLabel, TOOLS, type ToolContext } from './tools.ts';

/** Nom affiché dans l'historique et l'activité pour les modifications faites par l'assistant (« via … »). */
export const AI_VIA = 'Assistant IA';
const MAX_TOOL_OUTPUT = 14_000;
/** Jetons gardés pour la réponse et les outils ; estimation grossière : 4 caractères par jeton, ~1 000 par image. */
const RESERVED_TOKENS = 4_096;
const CHARS_PER_TOKEN = 4;
const TOKENS_PER_IMAGE = 1_000;

type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[] | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  /** Raisonnement exposé par certains fournisseurs (DeepSeek : `reasoning_content`, OpenRouter : `reasoning`). */
  reasoning_content?: string | null;
  reasoning?: string | null;
}

interface CompletionResponse {
  choices?: Array<{ message?: ChatMessage; finish_reason?: string }>;
  error?: { message?: string };
}

export class AiError extends Error {}

/** Appel `POST {baseUrl}/chat/completions` (format OpenAI v1, aussi accepté par Mistral, Ollama, LM Studio, vLLM…). */
export async function chatCompletion(config: Pick<AiEndpoint, 'baseUrl' | 'apiKey' | 'timeoutMs'>, model: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<ChatMessage> {
  const timeout = AbortSignal.timeout(config.timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
      body: JSON.stringify({ model, ...body }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    if ((error as Error).name === 'TimeoutError') {
      throw new AiError(`Le fournisseur d'IA n'a pas répondu dans le délai (${Math.round(config.timeoutMs / 1000)} s).`);
    }
    throw new AiError(`Fournisseur d'IA injoignable (${config.baseUrl}) : ${(error as Error).message}`);
  }
  const text = await response.text();
  let payload: CompletionResponse | null = null;
  try {
    payload = JSON.parse(text) as CompletionResponse;
  } catch {
    // Réponse non JSON : message d'erreur générique ci-dessous.
  }
  if (!response.ok) {
    throw new AiError(`Le fournisseur d'IA a répondu ${response.status} : ${payload?.error?.message ?? text.slice(0, 200)}`);
  }
  const message = payload?.choices?.[0]?.message;
  if (!message) throw new AiError("Réponse du fournisseur d'IA inattendue (aucun message).");
  return message;
}

function systemPrompt(ctx: AppContext, user: AuthUser, request: AiChatRequest, allowWrite: boolean, propose: boolean): string {
  const lines = [
    `Tu es l'assistant IA de ${getBranding(ctx.db).name}, un outil de suivi de projet (Kanban, tickets, livraisons). Nous sommes le ${todayISO()}.`,
    `Tu aides ${user.name}. Réponds dans la langue de son message, de façon concise, en Markdown.`,
    "Utilise les outils pour lire les données avant de répondre : n'invente jamais un ticket, une personne ou un identifiant. Cite les tickets par leur clé (ex. APP-12).",
    "Pour une recherche générale, utilise « search » (tous les champs) ; pour un ticket précis, « get_ticket ».",
    allowWrite
      ? propose
        ? "Tu peux proposer des modifications avec les outils d'écriture, uniquement quand la demande le justifie clairement : elles ne sont appliquées que lorsque la personne les valide dans le panneau. Termine en listant les modifications proposées."
        : "Tu peux modifier le projet avec les outils d'écriture, uniquement quand la demande le justifie clairement. Termine en listant les modifications faites."
      : "Tu es en lecture seule : si on te demande une modification, explique ce que tu ferais et indique qu'il faut cocher « Autoriser les modifications » dans le panneau (si la personne en a le droit).",
    "Colonnes (statuts) : backlog, todo, in_progress, blocked, review, done. Mentions dans un texte : @[Nom](user:ID) ou @[CLÉ-12](ticket:ID).",
    "Un ticket peut avoir des sous-tickets (champ parent, un seul niveau) ; les « sous-tâches » sont une liste de cases à cocher dans un ticket.",
  ];
  const projectId = request.context.projectId ?? null;
  if (projectId) {
    const access = resolveProjectAccess(ctx.db, user, projectId);
    if (access) lines.push(`Contexte ouvert : projet « ${access.project.name} » (id ${access.project.id}, clé ${access.project.key}).`);
  }
  const ticketId = request.context.ticketId ?? null;
  if (ticketId) {
    const ticket = ctx.db.get<{ id: number; project_id: number; number: number; title: string }>('SELECT id, project_id, number, title FROM tickets WHERE id = ?', ticketId);
    if (ticket && resolveProjectAccess(ctx.db, user, ticket.project_id)) {
      lines.push(`Ticket ouvert : ${ticketKeyOf(ctx.db, ticket)} « ${ticket.title} » (id ${ticket.id}). « ce ticket » désigne celui-ci.`);
    }
  }
  return lines.join('\n');
}

/**
 * Fait répondre l'assistant : boucle modèle ↔ outils (au plus `maxSteps` tours, réglés par l'administrateur), en signalant chaque étape.
 * Les outils agissent avec les droits de la personne, revérifiés à chaque appel.
 */
export async function runAgent(ctx: AppContext, user: AuthUser, request: AiChatRequest, emit: (event: AiStreamEvent) => void, signal?: AbortSignal): Promise<void> {
  const config = aiConfig(ctx);
  if (!config) throw new AiError("L'assistant IA est désactivé.");
  const actor: Actor = { userId: user.id, origin: null, via: AI_VIA };
  const resolved = resolveModel(config, request.model);
  if (!resolved) throw new AiError("Aucun modèle d'IA n'est proposé.");
  const { endpoint, model } = resolved;
  const propose = request.writeMode === 'propose';
  const tool: ToolContext = { ctx, user, actor, allowWrite: request.allowWrite, propose, changes: 0, proposals: 0, onChange: (change) => emit({ type: 'change', change }) };
  emit({ type: 'model', model: model.id, label: model.label || model.id });
  const tools = availableTools(request.allowWrite).map((definition) => ({
    type: 'function' as const,
    function: { name: definition.name, description: definition.description, parameters: definition.parameters },
  }));
  const budget = Math.max(4_000, model.contextWindow - RESERVED_TOKENS);
  const toolOutputMax = Math.max(2_000, Math.min(MAX_TOOL_OUTPUT * 4, Math.floor(budget * CHARS_PER_TOKEN * 0.25)));
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(ctx, user, request, request.allowWrite, propose) },
    ...fitConversation(request, model, budget, config.maxTurns),
  ];
  // Paramètres propres au modèle : niveau de réflexion, ou température basse pour les modèles classiques.
  const options: Record<string, unknown> = model.reasoning ? (request.reasoning ? { reasoning_effort: request.reasoning } : {}) : { temperature: 0.2 };
  const used: string[] = [];

  for (let step = 0; step < config.maxSteps; step += 1) {
    if (signal?.aborted) return;
    shrinkToolOutputs(messages, budget);
    const reply = await chatCompletion(endpoint, model.id, { messages, tools, tool_choice: 'auto', ...options }, signal);
    const thought = typeof reply.reasoning_content === 'string' ? reply.reasoning_content : typeof reply.reasoning === 'string' ? reply.reasoning : '';
    if (thought.trim()) emit({ type: 'thought', id: randomUUID(), text: thought.trim().slice(0, 20_000) });
    const calls = reply.tool_calls ?? [];
    if (!calls.length) {
      emit({ type: 'message', content: (typeof reply.content === 'string' ? reply.content.trim() : '') || '…' });
      emit({ type: 'done', changes: tool.changes });
      ctx.logger.info('ai', `Assistant IA : réponse (${step} appel(s) d'outils)`, { provider: endpoint.name, model: model.id, reasoning: request.reasoning ?? null, tools: used, changes: tool.changes, proposals: tool.proposals, allowWrite: request.allowWrite }, user.id);
      return;
    }
    messages.push({ role: 'assistant', content: reply.content ?? null, tool_calls: calls });
    for (const call of calls) {
      const id = call.id || randomUUID();
      const name = call.function.name;
      const write = TOOLS.find((entry) => entry.name === name)?.write ?? false;
      const label = toolLabel(name, call.function.arguments);
      emit({ type: 'step', id, tool: name, label, status: 'running', write });
      const { ok, result } = runTool(tool, name, call.function.arguments);
      used.push(name);
      const output = JSON.stringify(result);
      emit({ type: 'step', id, tool: name, label, status: ok ? 'done' : 'failed', write, ...(ok ? {} : { detail: (result as { error?: string }).error }) });
      messages.push({ role: 'tool', tool_call_id: id, content: output.length > toolOutputMax ? `${output.slice(0, toolOutputMax)}… (tronqué : précisez la demande)` : output });
    }
  }
  emit({ type: 'message', content: `J'ai atteint le nombre maximal d'étapes (${config.maxSteps}) pour cette question. Précisez la demande ou découpez-la.` });
  emit({ type: 'done', changes: tool.changes });
}

function estimate(message: ChatMessage): number {
  if (typeof message.content === 'string') return Math.ceil(message.content.length / CHARS_PER_TOKEN) + 4;
  if (!message.content) return 4;
  return message.content.reduce((sum, part) => sum + (part.type === 'text' ? Math.ceil(part.text.length / CHARS_PER_TOKEN) : TOKENS_PER_IMAGE), 4);
}

/**
 * Conversation envoyée au modèle : images seulement s'il a la vision, et anciens messages retirés pour tenir dans
 * son contexte (le dernier message est toujours gardé, raccourci au besoin).
 */
function fitConversation(request: AiChatRequest, model: AiModelDTO, budget: number, maxTurns: number): ChatMessage[] {
  // Tours de discussion : les `maxTurns` échanges précédents, plus la question posée.
  const converted = request.messages.slice(-(maxTurns * 2 + 1)).map((message): ChatMessage => {
    const text = message.content.slice(0, AI_LIMITS.messageChars);
    const images = message.role === 'user' ? (message.images ?? []) : [];
    if (!images.length) return { role: message.role, content: text };
    if (!model.vision) return { role: message.role, content: `${text}\n\n(${images.length} image(s) jointe(s), ignorée(s) : le modèle ${model.id} ne lit pas les images.)` };
    return { role: 'user', content: [{ type: 'text', text }, ...images.map((url): ContentPart => ({ type: 'image_url', image_url: { url } }))] };
  });
  const available = Math.floor(budget * 0.7);
  const kept: ChatMessage[] = [];
  let total = 0;
  for (let index = converted.length - 1; index >= 0; index -= 1) {
    const message = converted[index]!;
    const cost = estimate(message);
    if (kept.length && total + cost > available) break;
    kept.unshift(message);
    total += cost;
  }
  const last = kept.at(-1);
  if (last && typeof last.content === 'string' && estimate(last) > available) {
    last.content = last.content.slice(0, available * CHARS_PER_TOKEN);
  }
  // La conversation doit commencer par un message de la personne.
  while (kept.length > 1 && kept[0]!.role !== 'user') kept.shift();
  return kept;
}

/** Quand les résultats d'outils débordent du contexte, les plus anciens sont réduits à un résumé. */
function shrinkToolOutputs(messages: ChatMessage[], budget: number): void {
  let total = messages.reduce((sum, message) => sum + estimate(message), 0);
  for (const message of messages) {
    if (total <= budget) return;
    if (message.role === 'tool' && typeof message.content === 'string' && message.content.length > 600) {
      const before = estimate(message);
      message.content = `${message.content.slice(0, 500)}… (résultat raccourci pour tenir dans le contexte du modèle)`;
      total -= before - estimate(message);
    }
  }
}

/** Vérifie une configuration (même non enregistrée) : un court échange avec le modèle. */
export async function testAiConnection(endpoint: Pick<AiEndpoint, 'baseUrl' | 'apiKey' | 'timeoutMs'>, model: string): Promise<{ ok: boolean; message: string }> {
  try {
    const reply = await chatCompletion(endpoint, model, { messages: [{ role: 'user', content: 'Réponds simplement « OK ».' }] });
    const text = typeof reply.content === 'string' ? reply.content : '';
    return { ok: true, message: `Connexion réussie (${model}) : « ${text.trim().slice(0, 40)} »` };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}
