import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { AiContext, AiMessage, AiModelDTO, AiStreamEvent, ReasoningLevel } from '@shared/ai';
import { api } from '@/api';
import { httpHeaders } from '@/api/http';
import { translateServerMessage } from '@/i18n/server';

import { t } from '@/i18n';
export interface AiStep {
  id: string;
  label: string;
  status: 'running' | 'done' | 'failed';
  detail?: string;
  write: boolean;
}

export interface AiTurn {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  images?: string[];
  /** Modèle qui a répondu. */
  model?: string;
  steps: AiStep[];
  error?: string;
  changes?: number;
}

/** Conversation avec l'assistant IA (panneau latéral) : envoi en flux, étapes des outils, arrêt. */
export const useAiStore = defineStore('ai', () => {
  const open = ref(false);
  const turns = ref<AiTurn[]>([]);
  const busy = ref(false);
  const allowWrite = ref(false);
  let controller: AbortController | null = null;
  let nextId = 1;

  // --- Modèle et niveau de réflexion choisis (mémorisés dans ce navigateur) ---
  const PREFS_KEY = 'fb.ai.prefs';
  const models = ref<AiModelDTO[]>([]);
  const defaultModel = ref('');
  const chosenModel = ref<string | null>(null);
  const reasoning = ref<ReasoningLevel | null>(null);
  try {
    const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as { model?: string; reasoning?: ReasoningLevel | null };
    chosenModel.value = prefs.model ?? null;
    reasoning.value = prefs.reasoning ?? null;
  } catch {
    // Préférences indisponibles : modèle par défaut.
  }
  const model = computed<AiModelDTO | null>(
    () => models.value.find((entry) => entry.id === chosenModel.value) ?? models.value.find((entry) => entry.id === defaultModel.value) ?? models.value[0] ?? null,
  );

  function savePrefs(): void {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ model: chosenModel.value, reasoning: reasoning.value }));
    } catch {
      // Stockage indisponible : le choix vaut pour cette page seulement.
    }
  }

  function chooseModel(id: string): void {
    chosenModel.value = id;
    savePrefs();
  }

  function chooseReasoning(level: ReasoningLevel | null): void {
    reasoning.value = level;
    savePrefs();
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
  }

  function stop(): void {
    controller?.abort();
    controller = null;
    busy.value = false;
  }

  async function send(text: string, context: AiContext, canWrite: boolean, images: string[] = []): Promise<void> {
    const content = text.trim() || (images.length ? t('Que vois-tu sur cette image ?') : '');
    if (!content || busy.value) return;
    const attached = model.value?.vision ? images : [];
    const messages: AiMessage[] = [...history.value, { role: 'user', content, ...(attached.length ? { images: attached } : {}) }];
    turns.value.push({ id: nextId++, role: 'user', content, images: attached, steps: [] });
    turns.value.push({ id: nextId++, role: 'assistant', content: '', steps: [] });
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
          model: model.value?.id,
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
        else turn.steps.push({ id: event.id, label: event.label, status: event.status, detail: event.detail, write: event.write });
        break;
      }
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

  return { open, turns, busy, allowWrite, models, model, reasoning, loadModels, chooseModel, chooseReasoning, toggle, clear, stop, send };
});
