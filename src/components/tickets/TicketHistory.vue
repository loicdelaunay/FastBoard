<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import type { HistoryEntryDTO } from '@shared/types';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { useProjectStore } from '@/stores/project';
import { formatBytes } from '@/utils/files';
import { formatDateTime, formatRelative } from '@/utils/format';
import { FIELD_LABELS, SUBTASK_ACTIONS, formatChangeValue, historyIcon, linkReasonLabel } from '@/utils/historyFormat';
import { notifyError } from '@/utils/notify';

import { t } from '@/i18n';
const props = defineProps<{ ticketId: number }>();
const project = useProjectStore();

async function load(): Promise<void> {
  try {
    await project.loadHistory(props.ticketId);
  } catch (error) {
    notifyError(error, t('Historique indisponible'));
  }
}
onMounted(load);
watch(() => props.ticketId, load);

const entries = computed<HistoryEntryDTO[]>(() => project.history[props.ticketId] ?? []);

const show = formatChangeValue;

function author(entry: HistoryEntryDTO) {
  return entry.userId ? project.usersById.get(entry.userId) : undefined;
}

function icon(entry: HistoryEntryDTO): string {
  return historyIcon(entry.data);
}
</script>

<template>
  <div class="history">
    <ol v-if="entries.length" class="timeline">
      <li v-for="entry in entries" :key="entry.id" class="item">
        <span class="marker"><i :class="icon(entry)"></i></span>
        <div class="content">
          <div class="who">
            <UserAvatar :user="author(entry)" size="small" />
            <strong>{{ author(entry)?.name ?? $t('Système') }}</strong>
            <span v-if="entry.via" v-tooltip.top="$t('Via le jeton d\'API « {via} »', { via: entry.via })" class="via small"><i class="pi pi-microchip-ai"></i> {{ $t('via « {via} »', { via: entry.via }) }}</span>
            <time :datetime="entry.createdAt" :title="formatDateTime(entry.createdAt)" class="muted small">{{ formatRelative(entry.createdAt) }}</time>
          </div>

          <p v-if="entry.data.kind === 'created'" class="text">{{ $t('a créé le ticket « {title} »', { title: entry.data.title }) }}<template v-if="entry.data.assignees?.length"> {{ $t("et l'a assigné à {names}", { names: entry.data.assignees.map((user) => user.name).join(', ') }) }}</template>.</p>

          <template v-else-if="entry.data.kind === 'updated'">
            <p v-if="entry.data.auto === 'all_parts_done'" class="text auto">{{ $t('Toutes les parts sont terminées : le ticket passe automatiquement à « Terminé ».') }}</p>
            <p v-else-if="entry.data.auto === 'part_reopened'" class="text auto">{{ $t('Une part a été rouverte : le ticket repasse « En cours ».') }}</p>
            <p v-for="change in entry.data.changes" :key="change.field" class="text"> {{ $t('a modifié {field} :', { field: FIELD_LABELS[change.field] }) }} <span class="from">{{ show(change, 'from') }}</span>
              <i class="pi pi-arrow-right arrow"></i>
              <span class="to">{{ show(change, 'to') }}</span>
            </p>
          </template>

          <template v-else-if="entry.data.kind === 'assignees'">
            <p v-if="entry.data.added.length" class="text">{{ $t('a assigné {names}.', { names: entry.data.added.map((user) => user.name).join(', ') }) }}</p>
            <p v-if="entry.data.removed.length" class="text">{{ $t('a retiré {names}.', { names: entry.data.removed.map((user) => user.name).join(', ') }) }}</p>
          </template>

          <p v-else-if="entry.data.kind === 'attachment'" class="text">
            {{ entry.data.action === 'added' ? $t('a joint') : $t('a retiré') }} <strong>{{ entry.data.name }}</strong> ({{ entry.data.link ? (entry.data.link === 'url' ? $t('lien web') : $t('fichier local')) : formatBytes(entry.data.size) }}).
          </p>

          <p v-else-if="entry.data.kind === 'subtask'" class="text">
            {{ SUBTASK_ACTIONS[entry.data.action] }} <strong>« {{ entry.data.title }} »</strong><template v-if="entry.data.previousTitle"> {{ $t('(avant : « {previousName} »)', { previousName: entry.data.previousTitle }) }}</template>.
          </p>

          <p v-else-if="entry.data.kind === 'link'" class="text">
            {{ entry.data.action === 'added' ? $t('a ajouté la dépendance') : $t('a retiré la dépendance') }} <em>{{ linkReasonLabel(entry.data.reason) }}</em>
            <strong>{{ entry.data.target.key }}</strong> « {{ entry.data.target.title }} ».
          </p>

          <p v-else-if="entry.data.kind === 'transferred'" class="text">
            {{ $t('a déplacé le ticket du projet « {from} » ({fromKey}) vers « {to} » ({toKey}).', { from: entry.data.from.project, fromKey: entry.data.from.key, to: entry.data.to.project, toKey: entry.data.to.key }) }}
          </p>

          <p v-else-if="entry.data.kind === 'part'" class="text">
            <template v-if="entry.data.note === ''">{{ $t('a effacé la mission de') }} <strong>{{ entry.data.user.name }}</strong>.</template>
            <template v-else-if="entry.data.note !== undefined">{{ $t('a défini la mission de') }} <strong>{{ entry.data.user.name }}</strong> : <q class="quote">{{ entry.data.note }}</q></template>
            <template v-else-if="entry.data.done === true">{{ $t('a déclaré que') }} <strong>{{ entry.data.user.name }}</strong> {{ $t('a terminé sa part.') }}</template>
            <template v-else-if="entry.data.done === false">{{ $t('a rouvert la part de') }} <strong>{{ entry.data.user.name }}</strong>.</template>
            <template v-else>{{ $t('a réglé l\'avancement de') }} <strong>{{ entry.data.user.name }}</strong> à {{ entry.data.progress }} %.</template>
          </p>
        </div>
      </li>
    </ol>
    <p v-else-if="project.history[ticketId]" class="muted empty">{{ $t('Aucune modification enregistrée.') }}</p>
    <p v-else class="muted empty"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</p>
  </div>
</template>

<style scoped>
.timeline {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.timeline::before {
  content: '';
  position: absolute;
  left: 0.85rem;
  top: 0.4rem;
  bottom: 0.4rem;
  width: 2px;
  background: var(--fb-border);
}
.item {
  position: relative;
  display: flex;
  gap: 0.8rem;
}
.marker {
  z-index: 1;
  display: grid;
  place-items: center;
  flex: none;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 50%;
  background: var(--fb-panel);
  border: 2px solid var(--fb-border);
  color: var(--fb-accent);
  font-size: 0.75rem;
}
.content {
  min-width: 0;
}
.who {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.15rem 0.5rem;
}
.via {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0 0.4rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--fb-accent) 14%, transparent);
  color: var(--fb-accent);
  font-weight: 600;
}
.text {
  margin: 0.2rem 0 0;
  overflow-wrap: anywhere;
}
.text.auto {
  color: var(--fb-muted);
  font-style: italic;
}
.quote {
  font-style: italic;
  color: var(--fb-muted);
  white-space: pre-wrap;
}
.from {
  color: var(--fb-muted);
  text-decoration: line-through;
}
.to {
  font-weight: 600;
}
.arrow {
  margin: 0 0.3rem;
  font-size: 0.7rem;
  color: var(--fb-muted);
}
.empty {
  padding: 0.5rem 0;
  text-align: center;
}
</style>
