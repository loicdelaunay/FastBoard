<script setup lang="ts">
import Button from 'primevue/button';
import Tag from 'primevue/tag';
import type { ApiTokenDTO } from '@shared/types';
import { useProjectsStore } from '@/stores/projects';
import { formatDateTime, formatRelative } from '@/utils/format';
import { SCOPE_LABEL, TOKEN_STATE_LABEL, tokenState } from '@/utils/tokens';

import { t } from '@/i18n';
defineProps<{ tokens: ApiTokenDTO[]; showOwner?: boolean }>();
const emit = defineEmits<{ revoke: [token: ApiTokenDTO] }>();

const projects = useProjectsStore();

function projectsLabel(token: ApiTokenDTO): string {
  if (token.projectIds === null) {
    return t('Tous les projets');
  }
  const names = token.projectIds.map((id) => projects.projects.find((project) => project.id === id)?.name ?? t('projet {id}', { id }));
  return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
}

const SEVERITY = { active: 'success', expired: 'warn', revoked: 'secondary' } as const;
</script>

<template>
  <ul v-if="tokens.length" class="tokens">
    <li v-for="token in tokens" :key="token.id" class="token card" :class="{ inactive: tokenState(token) !== 'active' }">
      <div class="main">
        <div class="title">
          <strong class="name truncate">{{ token.name }}</strong>
          <Tag :value="TOKEN_STATE_LABEL[tokenState(token)]" :severity="SEVERITY[tokenState(token)]" />
          <Tag :value="SCOPE_LABEL[token.scope]" :severity="token.scope === 'read' ? 'info' : 'contrast'" />
        </div>
        <code class="prefix">{{ token.prefix }}…</code>
        <p class="meta muted small">
          <span v-if="showOwner && token.userName"><i class="pi pi-user"></i> {{ token.userName }}</span>
          <span><i class="pi pi-folder"></i> {{ projectsLabel(token) }}</span>
          <span :title="formatDateTime(token.createdAt)"><i class="pi pi-calendar-plus"></i> {{ $t('créé {value}', { value: formatRelative(token.createdAt) }) }}</span>
          <span v-if="token.lastUsedAt" :title="formatDateTime(token.lastUsedAt)"><i class="pi pi-bolt"></i> {{ $t('utilisé {value}', { value: formatRelative(token.lastUsedAt) }) }}</span>
          <span v-else><i class="pi pi-bolt"></i> {{ $t('jamais utilisé') }}</span>
          <span v-if="token.expiresAt" :title="formatDateTime(token.expiresAt)"><i class="pi pi-clock"></i> {{ $t('expire {value}', { value: formatRelative(token.expiresAt) }) }}</span>
          <span v-else><i class="pi pi-infinity"></i> {{ $t('n\'expire pas') }}</span>
        </p>
      </div>
      <Button
        v-if="tokenState(token) !== 'revoked'"
        :label="$t('Révoquer')"
        icon="pi pi-ban"
        severity="danger"
        text
        size="small"
        :aria-label="$t('Révoquer le jeton {name}', { name: token.name })"
        @click="emit('revoke', token)"
      />
    </li>
  </ul>
  <p v-else class="empty muted">{{ $t('Aucun jeton pour l\'instant.') }}</p>
</template>

<style scoped>
.tokens {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.token {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 0.9rem;
}
.token.inactive {
  opacity: 0.65;
}
.main {
  flex: 1;
  min-width: 0;
}
.title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem 0.5rem;
}
.name {
  max-width: 16rem;
}
.prefix {
  font: 0.8rem ui-monospace, 'Cascadia Mono', Consolas, monospace;
  color: var(--fb-muted);
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.15rem 1rem;
  margin: 0.3rem 0 0;
}
.meta i {
  margin-right: 0.25rem;
  font-size: 0.75rem;
}
.empty {
  padding: 1rem 0;
  text-align: center;
}
</style>
