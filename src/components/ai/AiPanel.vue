<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Button from 'primevue/button';
import Popover from 'primevue/popover';
import Select from 'primevue/select';
import SelectButton from 'primevue/selectbutton';
import ToggleSwitch from 'primevue/toggleswitch';
import { AI_LIMITS, REASONING_LEVELS, type AiWriteMode, type ReasoningLevel } from '@shared/ai';
import { imageToDataUrl } from '@/utils/image';
import { notifyError } from '@/utils/notify';
import MarkdownView from '@/components/common/MarkdownView.vue';
import AiChanges from './AiChanges.vue';
import AiHistory from './AiHistory.vue';
import AiSteps from './AiSteps.vue';
import { useAiStore } from '@/stores/ai';
import { useAuthStore } from '@/stores/auth';
import { useProjectStore } from '@/stores/project';
import { useProjectsStore } from '@/stores/projects';
import { ticketKey } from '@/utils/tickets';

import { t } from '@/i18n';
/**
 * Assistant IA : panneau à droite (comme Gemini dans Workspace), redimensionnable, ou page dédiée (`mode="page"`,
 * pour le garder ouvert dans un autre onglet). Il connaît le projet et le ticket ouverts, cherche partout, et ne
 * modifie que si la personne coche « Autoriser les modifications » (et en a le droit).
 */
const props = withDefaults(defineProps<{ mode?: 'panel' | 'page' }>(), { mode: 'panel' });
const page = computed(() => props.mode === 'page');

const ai = useAiStore();
const auth = useAuthStore();
const project = useProjectStore();
const projects = useProjectsStore();
const route = useRoute();
const router = useRouter();

const input = ref('');
const images = ref<string[]>([]);
const picker = ref<HTMLInputElement | null>(null);
const settingsPanel = ref<InstanceType<typeof Popover> | null>(null);
const showHistory = ref(false);

const REASONING_LABELS = computed<Record<ReasoningLevel, string>>(() => ({ minimal: t('Minimale'), low: t('Faible'), medium: t('Moyenne'), high: t('Élevée') }));
// « Auto » : valeur sentinelle (SelectButton ne marque pas une option de valeur null comme choisie).
const reasoningOptions = computed(() => [{ value: 'auto', label: t('Auto') }, ...REASONING_LEVELS.map((level) => ({ value: level, label: REASONING_LABELS.value[level] }))]);
const writeModeOptions = computed(() => [
  { value: 'apply', label: t('Appliquer directement') },
  { value: 'propose', label: t('Me les proposer') },
]);
const modelOptions = computed(() => {
  const groups = new Map<string, Array<{ value: string; label: string; vision: boolean; reasoning: boolean }>>();
  for (const entry of ai.models) {
    const list = groups.get(entry.provider) ?? [];
    list.push({ value: entry.ref, label: entry.label || entry.id, vision: entry.vision, reasoning: entry.reasoning });
    groups.set(entry.provider, list);
  }
  return [...groups].map(([provider, items]) => ({ label: provider, items }));
});
const formatTokens = (value: number) => (value >= 1_000_000 ? `${Math.round(value / 100_000) / 10} M` : `${Math.round(value / 1_000)} k`);

async function addImages(files: Blob[]): Promise<void> {
  if (!ai.model?.vision) return;
  for (const file of files.filter((entry) => entry.type.startsWith('image/')).slice(0, AI_LIMITS.imagesPerMessage - images.value.length)) {
    try {
      images.value.push(await imageToDataUrl(file));
    } catch (error) {
      notifyError(error, t('Image non jointe'));
    }
  }
}

function onPick(event: Event): void {
  const element = event.target as HTMLInputElement;
  void addImages(Array.from(element.files ?? []));
  element.value = '';
}

function onPaste(event: ClipboardEvent): void {
  const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'));
  if (files.length && ai.model?.vision) {
    event.preventDefault();
    void addImages(files);
  }
}
const list = ref<HTMLElement | null>(null);
const field = ref<HTMLTextAreaElement | null>(null);

// --- Contexte : page ouverte (panneau) ou paramètres de l'adresse / conversation rouverte (page dédiée) ---
const queryId = (name: string): number | null => {
  const raw = Array.isArray(route.query[name]) ? route.query[name][0] : route.query[name];
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
};
const routeProjectId = computed(() => {
  const value = Number(route.params.projectId);
  return Number.isInteger(value) && value > 0 ? value : null;
});
const inProject = computed(() => !page.value && routeProjectId.value !== null && project.projectId === routeProjectId.value && project.status === 'ready');
const ticket = computed(() => {
  const id = queryId('ticket');
  return inProject.value && id ? project.ticketsById.get(id) : undefined;
});
const pageContext = computed(() => (ai.turns.length ? ai.conversationContext : { projectId: queryId('project'), ticketId: queryId('ticket') }));
const context = computed(() => (page.value ? pageContext.value : { projectId: inProject.value ? routeProjectId.value : null, ticketId: ticket.value?.id ?? null }));
const canRead = computed(() => page.value || !inProject.value || project.can('ai.read'));
/** Droit de laisser l'IA modifier ce projet (et d'y modifier quelque chose soi-même) ; la page dédiée laisse le serveur vérifier. */
const canWrite = computed(
  () => page.value || (inProject.value && !project.archived && project.can('ai.write') && (project.can('ticket.edit') || project.can('ticket.create') || project.can('comment.create'))),
);
watch(canWrite, (value) => !value && (ai.allowWrite = false));

const contextLabel = computed(() => {
  if (page.value) {
    const projectName = projects.projects.find((entry) => entry.id === context.value.projectId)?.name;
    if (projectName) return context.value.ticketId ? t('{project} · ticket ouvert', { project: projectName }) : projectName;
    return t('Tous vos projets');
  }
  if (ticket.value) return `${ticketKey(project.project, ticket.value)} — ${ticket.value.title}`;
  if (inProject.value) return project.project?.name ?? '';
  return t('Tous vos projets');
});
const hasTicket = computed(() => Boolean(context.value.ticketId));
const hasProject = computed(() => Boolean(context.value.projectId));

const suggestions = computed(() =>
  hasTicket.value
    ? [t('Résume ce ticket et son historique'), t('Quels sont les risques ou les blocages de ce ticket ?'), t('Propose des sous-tâches pour ce ticket'), t('Rédige un commentaire de point d’avancement')]
    : hasProject.value
      ? [t('Où en est le projet ? Fais un point rapide'), t('Quels tickets sont en retard ou bloqués ?'), t('Qui est le plus chargé en ce moment ?'), t('Quels tickets parlent de paiement ?')]
      : [t('Sur quels projets ai-je des tickets en cours ?'), t('Cherche les tickets qui parlent de sécurité'), t('Quels tickets sont bloqués, tous projets confondus ?')],
);

async function scrollDown(): Promise<void> {
  await nextTick();
  list.value?.scrollTo({ top: list.value.scrollHeight, behavior: 'smooth' });
}
watch(() => ai.turns.map((turn) => `${turn.content.length}-${turn.steps.length}-${turn.edits?.length ?? 0}-${turn.error ?? ''}`).join(), scrollDown);
watch(
  () => page.value || ai.open,
  (visible) => {
    if (!visible) return;
    void ai.loadModels();
    if (page.value && !projects.loaded) void projects.fetch().catch(() => undefined);
    void nextTick(() => field.value?.focus());
  },
  { immediate: true },
);
// Un modèle sans vision ne reçoit pas d'images.
watch(() => ai.model?.vision, (vision) => !vision && (images.value = []));

function send(text = input.value): void {
  if ((!text.trim() && !images.value.length) || ai.busy || !canRead.value) return;
  showHistory.value = false;
  void ai.send(text, context.value, canWrite.value, images.value);
  input.value = '';
  images.value = [];
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    send();
  } else if (event.key === 'Escape' && !page.value) {
    // Échap ferme le panneau, pas la fenêtre du ticket ouverte dessous.
    event.stopPropagation();
    ai.toggle(false);
  }
}

function newConversation(): void {
  ai.clear();
  showHistory.value = false;
  if (page.value) void router.replace({ query: { ...route.query, c: undefined } });
}

/** Ouvre l'assistant en pleine page dans un nouvel onglet, avec la conversation et le contexte en cours. */
function openInTab(): void {
  const query: Record<string, string> = {};
  if (ai.turns.length) query.c = ai.conversationId;
  if (context.value.projectId) query.project = String(context.value.projectId);
  if (context.value.ticketId) query.ticket = String(context.value.ticketId);
  window.open(router.resolve({ name: 'assistant', query }).href, '_blank', 'noopener');
}

// La page dédiée garde l'identifiant de la conversation dans l'adresse (rechargement, autre onglet).
watch(
  () => [ai.conversationId, ai.turns.length] as const,
  ([id, length]) => {
    if (page.value && length && route.query.c !== id) void router.replace({ query: { ...route.query, c: id } });
  },
);

// --- Largeur du panneau : glisser le bord gauche ---
const resizing = ref(false);
function startResize(event: PointerEvent): void {
  event.preventDefault();
  resizing.value = true;
  const move = (moveEvent: PointerEvent) => ai.setWidth(window.innerWidth - moveEvent.clientX - 8, false);
  const end = () => {
    resizing.value = false;
    ai.setWidth(ai.width);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
}
function resizeWithKeys(event: KeyboardEvent): void {
  if (event.key === 'ArrowLeft') ai.setWidth(ai.width + 32);
  else if (event.key === 'ArrowRight') ai.setWidth(ai.width - 32);
}
onBeforeUnmount(() => (resizing.value = false));
</script>

<template>
  <Transition name="ai-slide">
    <aside v-if="page || ai.open" class="ai-panel" :class="{ page, resizing }" :style="page ? undefined : { width: `min(${ai.width}px, calc(100vw - 1rem))` }" role="complementary" :aria-label="$t('Assistant IA')">
      <div
        v-if="!page"
        v-tooltip.left="$t('Glissez pour élargir ou réduire')"
        class="resize"
        role="separator"
        aria-orientation="vertical"
        tabindex="0"
        :aria-label="$t('Largeur du panneau')"
        :aria-valuenow="ai.width"
        @pointerdown="startResize"
        @dblclick="ai.setWidth(420)"
        @keydown="resizeWithKeys"
      ></div>

      <aside v-if="page" class="side">
        <Button :label="$t('Nouvelle conversation')" icon="pi pi-plus" size="small" severity="secondary" outlined fluid @click="newConversation" />
        <AiHistory />
      </aside>

      <div class="main">
        <header class="head">
          <div class="title">
            <span class="glyph" aria-hidden="true"><i class="pi pi-sparkles"></i></span>
            <strong class="gradient-text">{{ $t('Assistant IA') }}</strong>
          </div>
          <Button v-if="!page" v-tooltip.bottom="$t('Conversations récentes')" icon="pi pi-history" text rounded size="small" :severity="showHistory ? undefined : 'secondary'" :aria-label="$t('Conversations récentes')" :aria-pressed="showHistory" @click="showHistory = !showHistory" />
          <Button v-tooltip.bottom="$t('Réglages de l’assistant')" icon="pi pi-cog" text rounded size="small" severity="secondary" :aria-label="$t('Réglages de l’assistant')" aria-haspopup="dialog" @click="settingsPanel?.toggle($event)" />
          <Button v-if="ai.turns.length && !page" v-tooltip.bottom="$t('Nouvelle conversation')" icon="pi pi-plus" text rounded size="small" severity="secondary" :aria-label="$t('Nouvelle conversation')" @click="newConversation" />
          <Button v-if="!page" v-tooltip.bottom="$t('Ouvrir en pleine page dans un nouvel onglet')" icon="pi pi-external-link" text rounded size="small" severity="secondary" :aria-label="$t('Ouvrir en pleine page dans un nouvel onglet')" @click="openInTab" />
          <Button v-if="!page" icon="pi pi-times" text rounded size="small" severity="secondary" :aria-label="$t('Fermer')" @click="ai.toggle(false)" />
        </header>

        <Popover ref="settingsPanel" class="ai-settings-panel">
          <div class="settings">
            <label class="setting">
              <span class="setting-label">{{ $t('Modèle') }}</span>
              <Select :model-value="ai.model?.ref" :options="modelOptions" option-label="label" option-value="value" option-group-label="label" option-group-children="items" size="small" fluid :empty-message="$t('Aucun modèle disponible')" @update:model-value="(ref: string) => ai.chooseModel(ref)">
                <template #option="{ option }">
                  <span class="model-option">
                    <span>{{ option.label }}</span>
                    <i v-if="option.vision" v-tooltip.top="$t('Vision')" class="pi pi-image muted"></i>
                    <i v-if="option.reasoning" v-tooltip.top="$t('Réflexion')" class="pi pi-lightbulb muted"></i>
                  </span>
                </template>
              </Select>
            </label>
            <p v-if="ai.model" class="caps muted small">
              <span><i class="pi pi-server"></i> {{ ai.model.provider }}</span>
              <span><i class="pi pi-image"></i> {{ ai.model.vision ? $t('Comprend les images') : $t('Sans vision') }}</span>
              <span><i class="pi pi-database"></i> {{ $t('Contexte {size} jetons', { size: formatTokens(ai.model.contextWindow) }) }}</span>
            </p>
            <div v-if="ai.model?.reasoning" class="setting">
              <span class="setting-label">{{ $t('Niveau de réflexion') }}</span>
              <SelectButton :model-value="ai.reasoning ?? 'auto'" :options="reasoningOptions" option-label="label" option-value="value" size="small" :allow-empty="false" @update:model-value="(level: ReasoningLevel | 'auto') => ai.chooseReasoning(level === 'auto' ? null : level)" />
              <small class="muted">{{ $t('Plus de réflexion : réponses plus sûres mais plus lentes.') }}</small>
            </div>
            <div v-if="canWrite" class="setting">
              <span class="setting-label">{{ $t('Modifications de l’assistant') }}</span>
              <SelectButton :model-value="ai.writeMode" :options="writeModeOptions" option-label="label" option-value="value" size="small" :allow-empty="false" @update:model-value="(mode: AiWriteMode) => ai.chooseWriteMode(mode)" />
              <small class="muted">{{ ai.writeMode === 'propose' ? $t('L’assistant prépare les modifications ; vous les appliquez ou les ignorez une à une.') : $t('Les modifications sont faites tout de suite ; vous pouvez les annuler depuis la réponse.') }}</small>
            </div>
          </div>
        </Popover>

        <div class="context">
          <span class="chip" :title="contextLabel"><i :class="hasTicket ? 'pi pi-ticket' : hasProject ? 'pi pi-folder' : 'pi pi-globe'"></i><span class="truncate">{{ contextLabel }}</span></span>
          <label v-if="canWrite" class="write" :class="{ on: ai.allowWrite }">
            <ToggleSwitch v-model="ai.allowWrite" :aria-label="$t('Autoriser les modifications')" />
            <span>{{ ai.writeMode === 'propose' ? $t('Autoriser les propositions') : $t('Autoriser les modifications') }}</span>
          </label>
          <span v-else-if="inProject" class="muted small read-only"><i class="pi pi-eye"></i> {{ $t('Lecture seule') }}</span>
        </div>

        <div v-if="showHistory && !page" class="messages">
          <AiHistory @opened="showHistory = false" />
        </div>
        <div v-else ref="list" class="messages" aria-live="polite">
          <div v-if="!canRead" class="empty">
            <i class="pi pi-lock"></i>
            <p>{{ $t('L’assistant IA n’a pas accès à ce projet avec votre rôle.') }}</p>
          </div>
          <div v-else-if="!ai.turns.length" class="empty">
            <div class="orb" aria-hidden="true"></div>
            <p class="hello">{{ $t('Bonjour {name}, que puis-je faire pour vous ?', { name: auth.user?.name?.split(' ')[0] ?? '' }) }}</p>
            <p class="muted small">{{ hasTicket ? $t('Je connais le ticket ouvert et son projet.') : hasProject ? $t('Je connais le projet ouvert et je peux chercher dans tous ses tickets.') : $t('Je peux chercher dans tous les projets auxquels vous avez accès.') }}</p>
            <div class="suggestions">
              <button v-for="suggestion in suggestions" :key="suggestion" type="button" class="suggestion" @click="send(suggestion)">{{ suggestion }}</button>
            </div>
          </div>

          <template v-for="(turn, index) in ai.turns" :key="turn.id">
            <div v-if="turn.role === 'user'" class="bubble user">
              <div v-if="turn.images?.length" class="thumbs"><img v-for="(src, imageIndex) in turn.images" :key="imageIndex" :src="src" alt="" /></div>
              <span v-else-if="turn.imageCount" class="muted small image-count"><i class="pi pi-image"></i> {{ $t('{n} image jointe|{n} images jointes', { n: turn.imageCount }) }}</span>
              {{ turn.content }}
            </div>
            <div v-else class="bubble assistant">
              <AiSteps :steps="turn.steps" :running="ai.busy && index === ai.turns.length - 1" />
              <AiChanges :turn="turn" />
              <MarkdownView v-if="turn.content" :text="turn.content" class="answer" />
              <div v-else-if="!turn.error" class="thinking" aria-label="…"><span></span><span></span><span></span></div>
              <p v-if="turn.error" class="error"><i class="pi pi-exclamation-triangle"></i> {{ turn.error }}</p>
              <p v-if="turn.model && (turn.content || turn.error)" class="model-used muted"><i class="pi pi-microchip-ai"></i> {{ turn.model }}</p>
            </div>
          </template>
        </div>

        <div v-if="images.length" class="pending">
          <span v-for="(src, index) in images" :key="index" class="pending-image">
            <img :src="src" alt="" />
            <button type="button" :aria-label="$t('Retirer l’image')" @click="images.splice(index, 1)"><i class="pi pi-times"></i></button>
          </span>
        </div>
        <form class="composer" @submit.prevent="send()">
          <button v-if="ai.model?.vision" v-tooltip.top="$t('Joindre une image (ou collez-la)')" type="button" class="attach" :disabled="images.length >= AI_LIMITS.imagesPerMessage" :aria-label="$t('Joindre une image')" @click="picker?.click()"><i class="pi pi-image"></i></button>
          <input ref="picker" type="file" accept="image/*" multiple class="file" @change="onPick" />
          <textarea
            ref="field"
            v-model="input"
            rows="2"
            maxlength="4000"
            :disabled="!canRead"
            :placeholder="ai.allowWrite && canWrite ? $t('Demandez une analyse ou une modification…') : $t('Posez une question sur vos projets…')"
            :aria-label="$t('Message à l’assistant')"
            @keydown="onKeydown"
            @paste="onPaste"
          ></textarea>
          <Button v-if="ai.busy" type="button" icon="pi pi-stop-circle" rounded severity="secondary" :aria-label="$t('Arrêter')" @click="ai.stop()" />
          <Button v-else type="submit" icon="pi pi-send" rounded class="send" :disabled="(!input.trim() && !images.length) || !canRead" :aria-label="$t('Envoyer')" />
        </form>
        <p class="disclaimer muted">{{ $t('L’IA peut se tromper : vérifiez les informations importantes. Ses modifications apparaissent « via Assistant IA ».') }}</p>
      </div>
    </aside>
  </Transition>
</template>

<style scoped>
.ai-panel {
  position: fixed;
  /* Au-dessus de la fenêtre d'un ticket (modale PrimeVue, 1100) : l'assistant reste utilisable ticket ouvert. */
  z-index: 1150;
  top: calc(var(--fb-header-h) + 0.5rem);
  right: 0.5rem;
  bottom: 0.5rem;
  display: flex;
  border: 1px solid var(--fb-border);
  border-radius: 16px;
  background: var(--fb-panel);
  box-shadow: 0 20px 50px rgb(0 0 0 / 28%);
  overflow: hidden;
}
.ai-panel.resizing {
  user-select: none;
}
.ai-panel::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  z-index: 2;
  height: 3px;
  background: linear-gradient(90deg, #4f8cff, #a95cff, #ff6fa7, #ffb86b);
  background-size: 200% 100%;
  animation: fb-ai-flow 4s linear infinite;
}
/* Page dédiée : toute la place, historique à gauche. */
.ai-panel.page {
  position: relative;
  inset: auto;
  z-index: auto;
  flex: 1;
  min-height: 0;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.page .main {
  max-width: 60rem;
  margin: 0 auto;
}
.side {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 17rem;
  flex-shrink: 0;
  padding: 1rem 0.75rem;
  border-right: 1px solid var(--fb-border);
  background: var(--fb-panel-alt);
  overflow-y: auto;
}
.main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.resize {
  position: absolute;
  z-index: 3;
  top: 0;
  bottom: 0;
  left: 0;
  width: 6px;
  cursor: ew-resize;
}
.resize:hover,
.resize:focus-visible,
.resizing .resize {
  outline: none;
  background: linear-gradient(180deg, #4f8cff, #a95cff, #ff6fa7);
  opacity: 0.6;
}
.head {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  padding: 0.75rem 0.6rem 0.4rem 1rem;
}
.title {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  font-size: 1.05rem;
}
.glyph {
  display: grid;
  place-items: center;
  width: 1.8rem;
  height: 1.8rem;
  flex-shrink: 0;
  border-radius: 50%;
  background: conic-gradient(from 0deg, #4f8cff, #a95cff, #ff6fa7, #4f8cff);
  color: #fff;
  font-size: 0.8rem;
}
.gradient-text {
  background: linear-gradient(90deg, #4f8cff, #a95cff, #ff6fa7);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.context {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  padding: 0 1rem 0.6rem;
  border-bottom: 1px solid var(--fb-border);
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  max-width: 100%;
  padding: 0.15rem 0.6rem;
  border-radius: 999px;
  background: var(--fb-panel-alt);
  font-size: 0.78rem;
  font-weight: 600;
}
.write {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-left: auto;
  font-size: 0.8rem;
  cursor: pointer;
}
.write.on {
  color: #a95cff;
  font-weight: 700;
}
.read-only {
  margin-left: auto;
}
.messages {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.75rem;
  min-height: 0;
  padding: 1rem;
  overflow-y: auto;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  margin: auto 0;
  text-align: center;
}
.empty p {
  margin: 0;
}
.orb {
  width: 3.4rem;
  height: 3.4rem;
  margin-bottom: 0.4rem;
  border-radius: 50%;
  background: conic-gradient(from 90deg, #4f8cff, #a95cff, #ff6fa7, #ffb86b, #4f8cff);
  filter: blur(1px);
  animation: fb-ai-spin 5s linear infinite, fb-ai-breathe 3s ease-in-out infinite;
}
.hello {
  font-size: 1.05rem;
  font-weight: 700;
}
.suggestions {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  width: 100%;
  margin-top: 0.6rem;
}
.suggestion {
  padding: 0.55rem 0.8rem;
  border: 1px solid var(--fb-border);
  border-radius: 12px;
  background: var(--fb-panel);
  color: var(--fb-text);
  font: inherit;
  font-size: 0.85rem;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.suggestion:hover {
  border-color: #a95cff;
  background: color-mix(in srgb, #a95cff 8%, transparent);
}
.bubble {
  max-width: 100%;
  font-size: 0.9rem;
  overflow-wrap: anywhere;
}
.bubble.user {
  align-self: flex-end;
  max-width: 88%;
  padding: 0.55rem 0.8rem;
  border-radius: 14px 14px 4px 14px;
  background: var(--fb-accent-soft);
  white-space: pre-wrap;
}
.bubble.assistant {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.image-count {
  display: block;
  margin-bottom: 0.2rem;
}
.thinking {
  display: flex;
  gap: 0.3rem;
  padding: 0.3rem 0;
}
.thinking span {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: linear-gradient(135deg, #4f8cff, #ff6fa7);
  animation: fb-ai-bounce 1.2s ease-in-out infinite;
}
.thinking span:nth-child(2) {
  animation-delay: 0.15s;
}
.thinking span:nth-child(3) {
  animation-delay: 0.3s;
}
.error {
  margin: 0;
  color: var(--fb-danger);
  font-size: 0.85rem;
}
.settings {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 22rem;
  max-width: calc(100vw - 3rem);
}
.settings :deep(.p-selectbutton) {
  display: flex;
  flex-wrap: wrap;
}
.settings :deep(.p-togglebutton) {
  flex: 1 1 auto;
  padding-inline: 0.5rem;
  font-size: 0.78rem;
}
.setting {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.setting-label {
  font-weight: 700;
  font-size: 0.8rem;
}
.model-option {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.caps {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 0.8rem;
  margin: -0.3rem 0 0;
}
.thumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-bottom: 0.35rem;
}
.thumbs img {
  max-width: 7rem;
  max-height: 5rem;
  border-radius: 8px;
  object-fit: cover;
}
.model-used {
  margin: 0;
  font-size: 0.7rem;
}
.pending {
  display: flex;
  gap: 0.4rem;
  margin: 0 0.75rem 0.4rem;
}
.pending-image {
  position: relative;
}
.pending-image img {
  width: 3.4rem;
  height: 3.4rem;
  border-radius: 8px;
  object-fit: cover;
  border: 1px solid var(--fb-border);
}
.pending-image button {
  position: absolute;
  top: -0.35rem;
  right: -0.35rem;
  display: grid;
  place-items: center;
  width: 1.1rem;
  height: 1.1rem;
  border: 0;
  border-radius: 50%;
  background: var(--fb-danger);
  color: #fff;
  font-size: 0.55rem;
  cursor: pointer;
}
.attach {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  margin-bottom: 0.15rem;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--fb-muted);
  cursor: pointer;
}
.attach:hover:not(:disabled) {
  background: var(--fb-panel);
  color: #a95cff;
}
.file {
  display: none;
}
.composer {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
  margin: 0 0.75rem;
  padding: 0.5rem 0.5rem 0.5rem 0.8rem;
  border: 1px solid var(--fb-border);
  border-radius: 14px;
  background: var(--fb-panel-alt);
}
.composer:focus-within {
  border-color: #a95cff;
  box-shadow: 0 0 0 3px color-mix(in srgb, #a95cff 18%, transparent);
}
.composer textarea {
  flex: 1;
  min-height: 2.6rem;
  max-height: 10rem;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--fb-text);
  font: inherit;
  font-size: 0.9rem;
  resize: none;
}
.send {
  background: linear-gradient(135deg, #4f8cff, #a95cff);
  border: 0;
}
.disclaimer {
  margin: 0.4rem 1rem 0.6rem;
  font-size: 0.68rem;
  text-align: center;
}
.ai-slide-enter-active,
.ai-slide-leave-active {
  transition: transform 0.25s ease, opacity 0.25s ease;
}
.ai-slide-enter-from,
.ai-slide-leave-to {
  transform: translateX(1.5rem);
  opacity: 0;
}
@media (max-width: 760px) {
  .side {
    display: none;
  }
}
@keyframes fb-ai-flow {
  to {
    background-position: 200% 0;
  }
}
@keyframes fb-ai-spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes fb-ai-breathe {
  50% {
    scale: 1.08;
  }
}
@keyframes fb-ai-bounce {
  0%,
  80%,
  100% {
    transform: translateY(0);
    opacity: 0.5;
  }
  40% {
    transform: translateY(-5px);
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ai-panel::before,
  .orb,
  .thinking span {
    animation: none;
  }
}
</style>
