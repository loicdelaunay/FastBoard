<script setup lang="ts">
import { computed } from 'vue';
import { isTicketStatus } from '@shared/constants';
import { formatDateShort } from '@shared/dates';
import type { ActivityDTO, HistoryChange } from '@shared/types';
import StatusTag from '@/components/common/StatusTag.vue';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { useProjectStore } from '@/stores/project';
import { formatBytes } from '@/utils/files';
import { formatDateTime, formatRelative } from '@/utils/format';
import { fieldLabel, SUBTASK_ACTIONS, formatChangeValue, linkReasonLabel } from '@/utils/historyFormat';

import { t } from '@/i18n';
const props = defineProps<{ activity: ActivityDTO; fresh?: boolean }>();
const emit = defineEmits<{ open: [ticketId: number] }>();

const project = useProjectStore();

const author = computed(() => (props.activity.userId ? project.usersById.get(props.activity.userId) : undefined));
const authorName = computed(() => author.value?.name ?? t('Un ancien membre'));

const data = computed(() => props.activity.data);
const ticketData = computed(() => (data.value.kind === 'ticket' ? data.value : null));
const entry = computed(() => ticketData.value?.entry ?? null);

/** Un ticket supprimé depuis n'est plus cliquable. */
function canOpen(ticketId: number): boolean {
  return project.ticketsById.has(ticketId);
}

const ICONS: Record<string, string> = {
  created: 'pi pi-plus-circle',
  updated: 'pi pi-pencil',
  assignees: 'pi pi-users',
  part: 'pi pi-check-circle',
  attachment: 'pi pi-paperclip',
  subtask: 'pi pi-list-check',
  link: 'pi pi-link',
  priority: 'pi pi-flag',
  component: 'pi pi-box',
  ticket_deleted: 'pi pi-trash',
  ticket_transferred: 'pi pi-folder',
  transferred: 'pi pi-folder',
  comment: 'pi pi-comment',
  category: 'pi pi-tag',
  delivery: 'pi pi-truck',
  member: 'pi pi-user-plus',
  project: 'pi pi-cog',
};

const icon = computed(() => {
  const value = data.value;
  if (value.kind === 'ticket') {
    if (value.entry.kind === 'updated' && value.entry.changes.some((change) => change.field === 'status')) {
      return 'pi pi-arrow-right-arrow-left';
    }
    if (value.entry.kind === 'part' && value.entry.note !== undefined) {
      return 'pi pi-flag';
    }
    if (value.entry.kind === 'part' && value.entry.done === false) {
      return 'pi pi-replay';
    }
    return ICONS[value.entry.kind] ?? 'pi pi-pencil';
  }
  return ICONS[value.kind] ?? 'pi pi-circle';
});

const tone = computed(() => {
  const value = data.value;
  if (value.kind === 'ticket_deleted' || (value.kind === 'comment' && value.action === 'deleted') || (value.kind === 'member' && ['removed', 'left'].includes(value.action))) {
    return 'danger';
  }
  if (value.kind === 'ticket' && value.entry.kind === 'attachment' && value.entry.action === 'removed') {
    return 'danger';
  }
  if (value.kind === 'ticket' && value.entry.kind === 'part' && value.entry.done) {
    return 'good';
  }
  if (value.kind === 'ticket' && value.entry.kind === 'updated' && value.entry.changes.some((change) => change.field === 'status' && change.to === 'done')) {
    return 'good';
  }
  return 'neutral';
});

function statusOf(value: HistoryChange['from']) {
  return isTicketStatus(value) ? value : null;
}

const detailChanges = computed(() => (entry.value?.kind === 'updated' ? entry.value.changes.filter((change) => change.field !== 'status') : []));
const statusChange = computed(() => (entry.value?.kind === 'updated' ? entry.value.changes.find((change) => change.field === 'status') : undefined));

const ROLE_ACTIONS = { added: t('a ajouté'), removed: t('a retiré'), left: t('a quitté le projet'), role_changed: t('a changé le rôle de') } as const;
const CONFIG_ACTIONS = { created: t('a créé'), updated: t('a modifié'), deleted: t('a supprimé') } as const;
</script>

<template>
  <li class="item" :class="[`tone-${tone}`, { fresh }]">
    <div class="avatar">
      <UserAvatar :user="author" />
      <i v-if="activity.via" v-tooltip.top="$t('Via le jeton d\'API « {via} »', { via: activity.via })" class="pi pi-microchip-ai via-badge" :aria-label="$t('Action faite via l\'API')"></i>
    </div>

    <div class="body">
      <p class="sentence">
        <strong>{{ authorName }}</strong>{{ ' ' }}

        <!-- Tickets -->
        <template v-if="ticketData && entry">
          <template v-if="entry.kind === 'created'"> {{ $t('a créé') }} <button v-if="canOpen(ticketData.ticketId)" type="button" class="key" @click="emit('open', ticketData.ticketId)">{{ ticketData.ticketKey }}</button>
            <span v-else class="key gone">{{ ticketData.ticketKey }}</span>
            « {{ entry.title }} »<template v-if="entry.assignees?.length"> {{ $t("et l'a assigné à {names}", { names: entry.assignees.map((user) => user.name).join(', ') }) }}</template>.
          </template>

          <template v-else-if="entry.kind === 'updated' && entry.auto">
            <button v-if="canOpen(ticketData.ticketId)" type="button" class="key" @click="emit('open', ticketData.ticketId)">{{ ticketData.ticketKey }}</button>
            <span v-else class="key gone">{{ ticketData.ticketKey }}</span>
            <template v-if="entry.auto === 'all_parts_done'">{{ $t('passe automatiquement à « Terminé » : toutes les parts sont terminées.') }}</template>
            <template v-else>{{ $t('repasse automatiquement « En cours » : une part a été rouverte.') }}</template>
          </template>

          <template v-else-if="entry.kind === 'updated'">
            <template v-if="statusChange"> {{ $t('a déplacé') }} <button v-if="canOpen(ticketData.ticketId)" type="button" class="key" @click="emit('open', ticketData.ticketId)">{{ ticketData.ticketKey }}</button>
              <span v-else class="key gone">{{ ticketData.ticketKey }}</span>
              <span class="moves">
                <StatusTag v-if="statusOf(statusChange.from)" :status="statusOf(statusChange.from)!" compact />
                <i class="pi pi-arrow-right arrow"></i>
                <StatusTag v-if="statusOf(statusChange.to)" :status="statusOf(statusChange.to)!" compact />
              </span>
            </template>
            <template v-else> {{ $t('a modifié') }} <button v-if="canOpen(ticketData.ticketId)" type="button" class="key" @click="emit('open', ticketData.ticketId)">{{ ticketData.ticketKey }}</button>
              <span v-else class="key gone">{{ ticketData.ticketKey }}</span>
            </template>
          </template>

          <template v-else-if="entry.kind === 'assignees'">
            <template v-if="entry.added.length">{{ $t('a assigné {names} à', { names: entry.added.map((user) => user.name).join(', ') }) }} </template>
            <template v-if="entry.added.length && entry.removed.length">{{ $t('et') }} </template>
            <template v-if="entry.removed.length">{{ $t('a retiré {names} de', { names: entry.removed.map((user) => user.name).join(', ') }) }} </template>
            <button v-if="canOpen(ticketData.ticketId)" type="button" class="key" @click="emit('open', ticketData.ticketId)">{{ ticketData.ticketKey }}</button>
            <span v-else class="key gone">{{ ticketData.ticketKey }}</span>
          </template>

          <template v-else-if="entry.kind === 'part'">
            <template v-if="entry.note === ''">{{ $t('a effacé la mission de') }} <strong>{{ entry.user.name }}</strong> {{ $t('sur') }}</template>
            <template v-else-if="entry.note !== undefined">{{ $t('a défini la mission de') }} <strong>{{ entry.user.name }}</strong> {{ $t('sur') }}</template>
            <template v-else-if="entry.done === true">{{ $t('a marqué la part de') }} <strong>{{ entry.user.name }}</strong> {{ $t('comme terminée sur') }}</template>
            <template v-else-if="entry.done === false">{{ $t('a rouvert la part de') }} <strong>{{ entry.user.name }}</strong> {{ $t('sur') }}</template>
            <template v-else>{{ $t('a réglé l\'avancement de') }} <strong>{{ entry.user.name }}</strong> {{ $t('à {progress} % sur', { progress: entry.progress }) }}</template>
            <button v-if="canOpen(ticketData.ticketId)" type="button" class="key" @click="emit('open', ticketData.ticketId)">{{ ticketData.ticketKey }}</button>
            <span v-else class="key gone">{{ ticketData.ticketKey }}</span>
          </template>
          <template v-else-if="entry.kind === 'attachment'">
            {{ entry.action === 'added' ? $t('a joint') : $t('a retiré') }} <strong class="file">{{ entry.name }}</strong> ({{ entry.link ? (entry.link === 'url' ? $t('lien web') : $t('fichier local')) : formatBytes(entry.size) }}) {{ entry.action === 'added' ? $t('à') : $t('de') }}
            <button v-if="canOpen(ticketData.ticketId)" type="button" class="key" @click="emit('open', ticketData.ticketId)">{{ ticketData.ticketKey }}</button>
            <span v-else class="key gone">{{ ticketData.ticketKey }}</span>
          </template>
          <template v-else-if="entry.kind === 'subtask'">
            {{ SUBTASK_ACTIONS[entry.action] }} <strong>« {{ entry.title }} »</strong><template v-if="entry.previousTitle"> {{ $t('(avant : « {previousName} »)', { previousName: entry.previousTitle }) }}</template> {{ $t('sur') }}
            <button v-if="canOpen(ticketData.ticketId)" type="button" class="key" @click="emit('open', ticketData.ticketId)">{{ ticketData.ticketKey }}</button>
            <span v-else class="key gone">{{ ticketData.ticketKey }}</span>
          </template>
          <template v-else-if="entry.kind === 'link'">
            {{ entry.action === 'added' ? $t('a ajouté une dépendance sur') : $t('a retiré une dépendance de') }}
            <button v-if="canOpen(ticketData.ticketId)" type="button" class="key" @click="emit('open', ticketData.ticketId)">{{ ticketData.ticketKey }}</button>
            <span v-else class="key gone">{{ ticketData.ticketKey }}</span>
            : <em>{{ linkReasonLabel(entry.reason) }}</em>
            <button v-if="canOpen(entry.target.id)" type="button" class="key" @click="emit('open', entry.target.id)">{{ entry.target.key }}</button>
            <span v-else class="key gone">{{ entry.target.key }}</span>
          </template>
          <span v-if="entry.kind !== 'created'" class="title-ref">« {{ ticketData.ticketTitle }} »</span>
        </template>

        <template v-else-if="data.kind === 'ticket_transferred'">
          <template v-if="data.direction === 'out'">{{ $t('a déplacé') }} <span class="key gone">{{ data.ticketKey }}</span> « {{ data.ticketTitle }} » {{ $t('vers le projet « {name} » ({key})', { name: data.otherProject, key: data.otherKey }) }}</template>
          <template v-else>{{ $t('a fait venir') }} <button v-if="data.ticketId && canOpen(data.ticketId)" type="button" class="key" @click="emit('open', data.ticketId)">{{ data.ticketKey }}</button><span v-else class="key gone">{{ data.ticketKey }}</span> « {{ data.ticketTitle }} » {{ $t('du projet « {name} » ({key})', { name: data.otherProject, key: data.otherKey }) }}</template>
        </template>

        <template v-else-if="data.kind === 'ticket_deleted'"> {{ $t('a supprimé') }} <span class="key gone">{{ data.ticketKey }}</span> « {{ data.ticketTitle }} »
        </template>

        <!-- Commentaires -->
        <template v-else-if="data.kind === 'comment'">
          <template v-if="data.action === 'created'">{{ data.reply ? $t('a répondu sur') : $t('a commenté') }}</template>
          <template v-else>{{ $t('a supprimé un commentaire sur') }}</template>
          <button v-if="canOpen(data.ticketId)" type="button" class="key" @click="emit('open', data.ticketId)">{{ data.ticketKey }}</button>
          <span v-else class="key gone">{{ data.ticketKey }}</span>
          <span class="title-ref">« {{ data.ticketTitle }} »</span>
        </template>

        <!-- Configuration -->
        <template v-else-if="data.kind === 'category'">
          {{ $t('{action} la catégorie', { action: CONFIG_ACTIONS[data.action] }) }} <strong>« {{ data.name }} »</strong><template v-if="data.previousName"> {{ $t('(avant : « {previousName} »)', { previousName: data.previousName }) }}</template>
        </template>
        <template v-else-if="data.kind === 'priority'">
          {{ $t('{action} la priorité', { action: CONFIG_ACTIONS[data.action] }) }} <strong>« {{ $t(data.name) }} »</strong><template v-if="data.previousName"> {{ $t('(avant : « {previousName} »)', { previousName: $t(data.previousName) }) }}</template>
        </template>
        <template v-else-if="data.kind === 'component'">
          {{ $t('{action} le composant', { action: CONFIG_ACTIONS[data.action] }) }} <strong>« {{ data.name }} »</strong><template v-if="data.previousName"> {{ $t('(avant : « {previousName} »)', { previousName: data.previousName }) }}</template>
        </template>
        <template v-else-if="data.kind === 'delivery'">
          {{ $t('{action} la livraison', { action: CONFIG_ACTIONS[data.action] }) }} <strong>« {{ data.name }} »</strong><template v-if="data.previousName"> {{ $t('(avant : « {previousName} »)', { previousName: data.previousName }) }}</template>
          <template v-if="data.startDate && data.endDate"> {{ $t('— du {value} au {value2}', { value: formatDateShort(data.startDate, true), value2: formatDateShort(data.endDate, true) }) }}</template>
        </template>
        <template v-else-if="data.kind === 'project'"> {{ $t('a modifié le projet :') }} <template v-for="(change, index) in data.changes" :key="change.field">
            <template v-if="index">, </template>
            <template v-if="change.field === 'archived'">{{ change.to ? 'archivage' : $t('réactivation') }}</template>
            <template v-else-if="change.field === 'description'">{{ $t('description') }}</template>
            <template v-else-if="change.field === 'settings'">{{ $t('réglages ({to})', { to: change.to }) }}</template>
            <template v-else>{{ change.field === 'name' ? 'nom' : $t('clé') }} « {{ change.from }} » → « {{ change.to }} »</template>
          </template>
        </template>

        <!-- Membres -->
        <template v-else-if="data.kind === 'member'">
          <template v-if="data.action === 'left'">{{ ROLE_ACTIONS.left }}</template>
          <template v-else>
            {{ ROLE_ACTIONS[data.action] }} <strong>{{ data.user.name }}</strong>
            <template v-if="data.action === 'added'"> {{ $t('au projet (rôle {role})', { role: data.role }) }}</template>
            <template v-else-if="data.action === 'removed'"> {{ $t('du projet') }}</template>
            <template v-else> : {{ data.previousRole }} → {{ data.role }}</template>
          </template>
        </template>
      </p>

      <ul v-if="detailChanges.length" class="changes">
        <li v-for="change in detailChanges" :key="change.field + (change.label ?? '')">
          {{ fieldLabel(change) }} :
          <span class="from">{{ formatChangeValue(change, 'from') }}</span>
          <i class="pi pi-arrow-right arrow"></i>
          <span class="to">{{ formatChangeValue(change, 'to') }}</span>
        </li>
      </ul>

      <blockquote v-if="data.kind === 'comment' && data.excerpt" class="excerpt">{{ data.excerpt }}</blockquote>
      <blockquote v-else-if="entry?.kind === 'part' && entry.note" class="excerpt">{{ entry.note }}</blockquote>

      <p class="meta muted small">
        <i :class="icon"></i>
        <time :datetime="activity.createdAt" :title="formatDateTime(activity.createdAt)">{{ formatRelative(activity.createdAt) }}</time>
        <span v-if="activity.via" class="via"><i class="pi pi-microchip-ai"></i> {{ $t('via « {via} »', { via: activity.via }) }}</span>
      </p>
    </div>
  </li>
</template>

<style scoped>
.item {
  display: flex;
  gap: 0.8rem;
  padding: 0.75rem 0.9rem;
  border: 1px solid var(--fb-border);
  border-left: 4px solid var(--accent, var(--fb-border));
  border-radius: 10px;
  background: var(--fb-panel);
  list-style: none;
}
.item.fresh {
  animation: fb-flash 1.8s ease-out;
}
.tone-good {
  --accent: #22c55e;
}
.tone-danger {
  --accent: #ef4444;
}
.avatar {
  position: relative;
  flex: none;
}
.via-badge {
  position: absolute;
  right: -0.35rem;
  bottom: -0.3rem;
  display: grid;
  place-items: center;
  width: 1.1rem;
  height: 1.1rem;
  border-radius: 50%;
  background: var(--fb-accent);
  color: var(--p-primary-contrast-color, #fff);
  font-size: 0.6rem;
  box-shadow: 0 0 0 2px var(--fb-panel);
}
.body {
  flex: 1;
  min-width: 0;
}
.sentence {
  margin: 0;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.key {
  display: inline;
  padding: 0.05rem 0.45rem;
  border: 0;
  border-radius: 6px;
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
  font: inherit;
  font-size: 0.82rem;
  font-weight: 800;
  letter-spacing: 0.02em;
  cursor: pointer;
}
button.key:hover {
  text-decoration: underline;
}
.key.gone {
  cursor: default;
  background: var(--fb-panel-alt);
  color: var(--fb-muted);
  text-decoration: line-through;
}
.sentence .key,
.sentence .title-ref,
.sentence .moves {
  margin: 0 0.2rem;
}
.title-ref {
  color: var(--fb-muted);
}
.moves {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  vertical-align: middle;
}
.arrow {
  font-size: 0.7rem;
  color: var(--fb-muted);
}
.changes {
  margin: 0.25rem 0 0;
  padding-left: 1.1rem;
  font-size: 0.88rem;
}
.from {
  color: var(--fb-muted);
  text-decoration: line-through;
}
.to {
  font-weight: 600;
}
.excerpt {
  margin: 0.4rem 0 0;
  padding: 0.35rem 0.75rem;
  border-left: 3px solid var(--fb-border);
  color: var(--fb-muted);
  font-size: 0.9rem;
  white-space: pre-wrap;
}
.meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem 0.75rem;
  margin: 0.35rem 0 0;
}
.meta i {
  font-size: 0.75rem;
}
.via {
  color: var(--fb-accent);
  font-weight: 600;
}
</style>
