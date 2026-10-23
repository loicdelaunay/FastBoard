import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { AiChangeDTO, AiContext, AiConversationSummaryDTO, AiMessage, AiModelChoiceDTO, AiStreamEvent, AiWriteMode, ReasoningLevel } from '@shared/ai';
import { api } from '@/api';
import { httpHeaders } from '@/api/http';
import { translateServerMessage } from '@/i18n/server';
import { performChange, undoChange } from '@/utils/aiChanges';
import { notifyError } from '@/utils/notify';

import { t } from '@/i18n';
export interface AiStep {
  id: string;
  /** `tool` : outil utilisé ; `thought` : raisonnement exposé par le modèle. */
  kind: 'tool' | 'thought';
  label: string;
  status: 'running' | 'done' | 'failed';
  detail?: string;
  write: boolean;
  text?: string;
}

export interface AiTurn {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  images?: string[];
  /** Images jointes non conservées dans l'historique enregistré. */
  imageCount?: number;
  /** Modèle qui a répondu. */
  model?: string;
  steps: AiStep[];
  error?: string;
  changes?: number;
  /** Modifications faites ou proposées pendant cette réponse. */
  edits?: AiChangeDTO[];
}

const PREFS_KEY = 'fb.ai.prefs';
export const PANEL_WIDTH = { min: 340, max: 1100, default: 420 };

function newConversationId(): string {
  return crypto.randomUUID();
}

/** Conversation avec l'assistant IA (panneau latéral ou page dédiée) : envoi en flux, étapes, modifications, historique. */
export const useAiStore = defineStore('ai', () => {
  const open = ref(false);
  const turns = ref<AiTurn[]>([]);
  const busy = ref(false);
  const allowWrite = ref(false);
  let controller: AbortController | null = null;
  let nextId = 1;

  // --- Préférences (mémorisées dans ce navigateur) : modèle, réflexion, mode des modifications, largeur du panneau ---
  const models = ref<AiModelChoiceDTO[]>([]);
  const defaultModel = ref('');
  const chosenModel = ref<string | null>(null);
  const reasoning = ref<ReasoningLevel | null>(null);
  const writeMode = ref<AiWriteMode>('apply');
  const width = ref(PANEL_WIDTH.default);
  try {
    const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as { model?: string; reasoning?: ReasoningLevel | null; writeMode?: AiWriteMode; width?: number };
    chosenModel.value = prefs.model ?? null;
    reasoning.value = prefs.reasoning ?? null;
    writeMode.value = prefs.writeMode === 'propose' ? 'propose' : 'apply';
    if (typeof prefs.width === 'number') width.value = Math.min(PANEL_WIDTH.max, Math.max(PANEL_WIDTH.min, prefs.width));
  } catch {
    // Préférences indisponibles : valeurs par défaut.
  }
  const model = computed<AiModelChoiceDTO | null>(
    () =>
      models.value.find((entry) => entry.ref === chosenModel.value) ??
      // Préférence enregistrée par la 1.3 (identifiant sans fournisseur).
      models.value.find((entry) => entry.id === chosenModel.value) ??
      models.value.find((entry) => entry.ref === defaultModel.value) ??
      models.value[0] ??
      null,
  );

  function savePrefs(): void {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ model: chosenModel.value, reasoning: reasoning.value, writeMode: writeMode.value, width: width.value }));
    } catch {
      // Stockage indisponible : le choix vaut pour cette page seulement.
    }
  }

  function chooseModel(ref: string): void {
    chosenModel.value = ref;
    savePrefs();
  }

  function chooseReasoning(level: ReasoningLevel | null): void {
    reasoning.value = level;
    savePrefs();
  }

  function chooseWriteMode(mode: AiWriteMode): void {
    writeMode.value = mode;
    savePrefs();
  }

  function setWidth(value: number, persist = true): void {
    width.value = Math.round(Math.min(PANEL_WIDTH.max, Math.max(PANEL_WIDTH.min, value)));
    if (persist) savePrefs();
  }

  async function loadModels(): Promise<void> {
    try {
      const result = await api.aiModels();
      models.value = result.models;
      defaultModel.value = result.defaultModel;
    } catch {
      models.value = [];
    }
  }

  // --- Conversation en cours et historique (50 dernières, enregistrées sur le serveur) ---
  const conversationId = ref(newConversationId());
  const conversationContext = ref<AiContext>({});
  const conversations = ref<AiConversationSummaryDTO[]>([]);
  const historyLoading = ref(false);

  const history = computed<AiMessage[]>(() =>
    turns.value
      .filter((turn) => turn.content && !turn.error)
      .map((turn) => ({ role: turn.role, content: turn.content, ...(turn.images?.length ? { images: turn.images } : {}) })),
  );

  function toggle(value = !open.value): void {
    open.value = value;
  }

  function clear(): void {
    stop();
    turns.value = [];
    conversationId.value = newConversationId();
    conversationContext.value = {};
  }

  function stop(): void {
    controller?.abort();
    controller = null;
    busy.value = false;
  }

  async function loadConversations(): Promise<void> {
    historyLoading.value = true;
    try {
      conversations.value = (await api.aiConversations()).conversations;
    } catch (error) {
      notifyError(error, t('Historique indisponible'));
    } finally {
      historyLoading.value = false;
    }
  }

  async function openConversation(id: string): Promise<void> {
    if (busy.value) stop();
    try {
      const { conversation } = await api.aiConversation(id);
      turns.value = conversation.turns as AiTurn[];
      nextId = turns.value.reduce((max, turn) => Math.max(max, turn.id), 0) + 1;
      conversationId.value = conversation.id;
      conversationContext.value = conversation.context;
    } catch (error) {
      notifyError(error, t('Conversation introuvable'));
    }
  }

  async function deleteConversation(id: string): Promise<void> {
    try {
      await api.aiDeleteConversation(id);
      conversations.value = conversations.value.filter((entry) => entry.id !== id);
      if (conversationId.value === id) clear();
    } catch (error) {
      notifyError(error);
    }
  }

  /** Enregistre la conversation (sans les images, trop lourdes : leur nombre est gardé). */
  async function persist(): Promise<void> {
    const first = turns.value.find((turn) => turn.role === 'user');
    if (!first) return;
    const saved = turns.value.map(({ images, ...turn }) => ({ ...turn, ...(images?.length ? { imageCount: images.length } : {}) }));
    const title = first.content.replace(/\s+/g, ' ').trim().slice(0, 100) || t('Conversation');
    try {
      const { conversation } = await api.aiSaveConversation(conversationId.value, { title, context: conversationContext.value, turns: saved });
      conversations.value = [conversation, ...conversations.value.filter((entry) => entry.id !== conversation.id)];
    } catch {
      // Historique non enregistré : la conversation reste affichée.
    }
  }

  async function send(text: string, context: AiContext, canWrite: boolean, images: string[] = []): Promise<void> {
    const content = text.trim() || (images.length ? t('Que vois-tu sur cette image ?') : '');
    if (!content || busy.value) return;
    const attached = model.value?.vision ? images : [];
    const messages: AiMessage[] = [...history.value, { role: 'user', content, ...(attached.length ? { images: attached } : {}) }];
    if (!turns.value.length) conversationContext.value = { projectId: context.projectId ?? null, ticketId: context.ticketId ?? null };
    turns.value.push({ id: nextId++, role: 'user', content, images: attached, steps: [] });
    turns.value.push({ id: nextId++, role: 'assistant', content: '', steps: [], edits: [] });
    // L'objet réactif (et non l'objet brut) : ses modifications pendant le flux s'affichent.
    const answer = turns.value[turns.value.length - 1]!;
    busy.value = true;
    controller = new AbortController();
    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { ...httpHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          context,
          allowWrite: canWrite && allowWrite.value,
          writeMode: writeMode.value,
          model: model.value?.ref,
          ...(model.value?.reasoning && reasoning.value ? { reasoning: reasoning.value } : {}),
        }),
        credentials: 'same-origin',
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message ? translateServerMessage(payload.error.message) : t('Erreur {status}', { status: response.status }));
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let index: number;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const line = chunk.split('\n').find((entry) => entry.startsWith('data: '));
          if (line) apply(answer, JSON.parse(line.slice(6)) as AiStreamEvent);
        }
      }
      if (!answer.content && !answer.error) answer.error = t('La réponse a été interrompue.');
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        answer.error = t('Réponse arrêtée.');
      } else {
        answer.error = error instanceof Error ? error.message : String(error);
      }
    } finally {
      busy.value = false;
      controller = null;
      for (const step of answer.steps) if (step.status === 'running') step.status = 'failed';
      void persist();
    }
  }

  function apply(turn: AiTurn, event: AiStreamEvent): void {
    switch (event.type) {
      case 'model':
        turn.model = event.label;
        break;
      case 'step': {
        const existing = turn.steps.find((step) => step.id === event.id);
        if (existing) Object.assign(existing, { status: event.status, detail: event.detail });
        else turn.steps.push({ id: event.id, kind: 'tool', label: event.label, status: event.status, detail: event.detail, write: event.write });
        break;
      }
      case 'thought':
        turn.steps.push({ id: event.id, kind: 'thought', label: t('Réflexion du modèle'), status: 'done', write: false, text: event.text });
        break;
      case 'change':
        (turn.edits ??= []).push(event.change);
        break;
      case 'message':
        turn.content = event.content;
        break;
      case 'error':
        turn.error = translateServerMessage(event.message);
        break;
      case 'done':
        turn.changes = event.changes;
        break;
    }
  }

  // --- Modifications : voir, annuler, réappliquer, valider une proposition ---
  const changeBusy = ref<string | null>(null);

  async function transition(change: AiChangeDTO, run: (action: AiChangeDTO['action']) => Promise<AiChangeDTO['action']>, next: AiChangeDTO['state']): Promise<boolean> {
    changeBusy.value = change.id;
    try {
      change.action = await run(change.action);
      change.state = next;
      void persist();
      return true;
    } catch (error) {
      notifyError(error, t('Modification impossible'));
      return false;
    } finally {
      changeBusy.value = null;
    }
  }

  /** Valide une proposition, ou réapplique une modification annulée. */
  const applyChange = (change: AiChangeDTO) => transition(change, performChange, 'applied');
  const revertChange = (change: AiChangeDTO) => transition(change, undoChange, 'reverted');

  function rejectChange(change: AiChangeDTO): void {
    change.state = 'rejected';
    void persist();
  }

  /** Toutes les propositions d'une réponse, dans l'ordre (un ticket créé peut servir aux suivantes). */
  async function applyAll(turn: AiTurn): Promise<void> {
    for (const change of turn.edits ?? []) {
      if (change.state === 'pending' && !(await applyChange(change))) break;
    }
  }

  /** Annule toutes les modifications d'une réponse, de la dernière à la première. */
  async function revertAll(turn: AiTurn): Promise<void> {
    for (const change of [...(turn.edits ?? [])].reverse()) {
      if (change.state === 'applied' && !(await revertChange(change))) break;
    }
  }

  return {
    open, turns, busy, allowWrite, models, model, reasoning, writeMode, width,
    loadModels, chooseModel, chooseReasoning, chooseWriteMode, setWidth, toggle, clear, stop, send,
    conversationId, conversationContext, conversations, historyLoading, loadConversations, openConversation, deleteConversation,
    changeBusy, applyChange, revertChange, rejectChange, applyAll, revertAll,
  };
});
