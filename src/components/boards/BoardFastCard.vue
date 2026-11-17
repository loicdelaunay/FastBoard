<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { FastElement } from '@shared/boards';
import { api } from '@/api';
import { darkMode } from '@/theme/themeManager';
import { useAuthStore } from '@/stores/auth';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { loadFastRef, type FastData } from './editor/fastRefs';

/** Fast Element : un ticket, une note, un dossier, un espace de documentation ou un tableau, montré sur le tableau. */
const props = defineProps<{ element: FastElement }>();

const router = useRouter();
const data = ref<FastData | null>(null);
const failed = ref(false);
/** Un visiteur sans compte (tableau partagé) ne peut rien lire de FastBoard : on ne montre que le nom. */
const anonymous = !useAuthStore().isAuthenticated;

async function load(fresh = false): Promise<void> {
  if (anonymous) return;
  failed.value = false;
  try {
    data.value = await loadFastRef(props.element.ref.kind, props.element.ref.id, fresh);
  } catch {
    failed.value = true;
  }
}

onMounted(() => void load());
watch(() => `${props.element.ref.kind}:${props.element.ref.id}`, () => void load());

const ICONS = { ticket: 'pi pi-ticket', note: 'pi pi-file', folder: 'pi pi-folder', space: 'pi pi-book', board: 'pi pi-objects-column' } as const;
const icon = computed(() => ICONS[props.element.ref.kind]);

function open(childId?: number): void {
  const value = data.value;
  if (!value) return;
  switch (value.kind) {
    case 'ticket':
      void router.push({ name: 'project', params: { projectId: value.preview.projectId }, query: { ticket: String(value.preview.id) } });
      break;
    case 'note':
      void router.push({ name: 'doc-space', params: { spaceId: value.spaceId }, query: { file: String(props.element.ref.id) } });
      break;
    case 'folder':
      void router.push(childId ? { name: 'doc-file', params: { nodeId: childId } } : { name: 'doc-space', params: { spaceId: value.spaceId } });
      break;
    case 'space':
      void router.push({ name: 'doc-space', params: { spaceId: props.element.ref.id } });
      break;
    case 'board':
      void router.push({ name: 'board-space', params: { spaceId: value.spaceId }, query: { board: String(props.element.ref.id) } });
      break;
  }
}
</script>

<template>
  <div class="fast-card" :class="`k-${element.ref.kind}`">
    <header class="head">
      <span class="badge"><i :class="icon"></i></span>
      <strong class="title truncate">{{ data?.title ?? element.label }}</strong>
      <button v-if="data" v-tooltip.top="$t('Ouvrir')" type="button" class="open" :aria-label="$t('Ouvrir')" @pointerdown.stop @click.stop="open()"><i class="pi pi-external-link"></i></button>
      <button v-else-if="failed" v-tooltip.top="$t('Réessayer')" type="button" class="open" :aria-label="$t('Réessayer')" @pointerdown.stop @click.stop="load(true)"><i class="pi pi-refresh"></i></button>
    </header>

    <div v-if="anonymous" class="body muted small">{{ $t('Visible par les personnes connectées.') }}</div>
    <div v-else-if="failed" class="body muted small">{{ $t('Inaccessible : supprimé, ou vous n’y avez pas accès.') }}</div>
    <div v-else-if="!data" class="body muted small"><i class="pi pi-spin pi-spinner"></i></div>

    <div v-else-if="data.kind === 'ticket'" class="body">
      <div class="meta">
        <span class="status" :style="{ backgroundColor: data.preview.statusColor }">{{ data.preview.statusLabel }}</span>
        <span class="muted small truncate">{{ data.preview.projectName }}</span>
      </div>
      <p v-if="data.preview.excerpt" class="excerpt">{{ data.preview.excerpt }}</p>
      <div class="foot">
        <div class="progress" :aria-label="$t('Avancement')"><span :style="{ width: `${data.preview.progress}%` }"></span></div>
        <span class="small muted">{{ data.preview.progress }} %</span>
        <span class="avatars">
          <UserAvatar v-for="user in data.preview.assignees.slice(0, 3)" :key="user.id" :user="user" size="small" />
        </span>
      </div>
    </div>

    <div v-else-if="data.kind === 'note'" class="body">
      <p class="muted small path truncate">{{ data.path }}</p>
      <p class="excerpt">{{ data.excerpt || $t('Note vide.') }}</p>
    </div>

    <div v-else-if="data.kind === 'folder'" class="body fast-card-scroll">
      <ul class="children">
        <li v-for="child in data.children.slice(0, 8)" :key="child.id">
          <button type="button" class="child" @pointerdown.stop @click.stop="open(child.id)">
            <i :class="child.folder ? 'pi pi-folder' : 'pi pi-file'"></i><span class="truncate">{{ child.title }}</span>
          </button>
        </li>
        <li v-if="!data.children.length" class="muted small">{{ $t('Dossier vide.') }}</li>
        <li v-else-if="data.children.length > 8" class="muted small">{{ $t('et {n} autres…', { n: data.children.length - 8 }) }}</li>
      </ul>
    </div>

    <div v-else-if="data.kind === 'space'" class="body">
      <p class="excerpt">{{ data.description || $t('Espace de documentation') }}</p>
      <p class="muted small">{{ $t('{n} note|{n} notes', { n: data.count }) }}</p>
    </div>

    <div v-else-if="data.kind === 'board'" class="body preview">
      <img :src="api.boardPreviewUrl(element.ref.id, 480, darkMode)" :alt="data.title" draggable="false" />
      <span class="muted small">{{ data.spaceName }}</span>
    </div>
  </div>
</template>

<style scoped>
.fast-card {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border: 1.5px solid color-mix(in srgb, var(--fb-accent) 55%, var(--fb-border));
  border-radius: 12px;
  background: var(--fb-panel);
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.08);
  color: var(--fb-text);
  font-size: 13px;
}
.head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 0.6rem 0.4rem;
}
.badge {
  display: grid;
  place-items: center;
  width: 1.7rem;
  height: 1.7rem;
  flex: none;
  border-radius: 7px;
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
}
.k-ticket .badge {
  background: color-mix(in srgb, #f97316 18%, transparent);
  color: #ea580c;
}
.k-board .badge {
  background: color-mix(in srgb, #a855f7 18%, transparent);
  color: #9333ea;
}
.title {
  flex: 1;
  min-width: 0;
  font-size: 14px;
}
.open {
  display: grid;
  place-items: center;
  width: 1.7rem;
  height: 1.7rem;
  flex: none;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--fb-muted);
  cursor: pointer;
}
.open:hover {
  background: var(--fb-panel-alt);
  color: var(--fb-accent);
}
.body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.4rem;
  min-height: 0;
  padding: 0 0.75rem 0.6rem;
}
.meta,
.foot {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.foot {
  margin-top: auto;
}
.status {
  padding: 0.05rem 0.5rem;
  border-radius: 999px;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
}
.excerpt {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--fb-muted);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
  line-height: 1.4;
}
.path {
  margin: 0;
}
.progress {
  flex: 1;
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--fb-panel-alt);
}
.progress span {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--fb-accent);
}
.avatars {
  display: flex;
}
.avatars :deep(*) + :deep(*) {
  margin-left: -0.35rem;
}
.children {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}
.child {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  padding: 0.2rem 0.3rem;
  border: 0;
  border-radius: 5px;
  background: none;
  color: var(--fb-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.child:hover {
  background: var(--fb-panel-alt);
  color: var(--fb-accent);
}
.child .pi {
  color: var(--fb-muted);
  font-size: 0.8rem;
}
.preview img {
  flex: 1;
  min-height: 0;
  border-radius: 6px;
  background: var(--board-canvas);
  object-fit: contain;
}
</style>
