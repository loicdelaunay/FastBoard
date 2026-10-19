<script setup lang="ts">
import { computed } from 'vue';
import type { UserSummaryDTO } from '@shared/types';
import UserAvatar from './UserAvatar.vue';

const props = withDefaults(
  defineProps<{
    users: Array<Pick<UserSummaryDTO, 'id' | 'name' | 'avatarVersion'>>;
    max?: number;
    size?: 'small' | 'normal' | 'large';
    /** Utilisateurs à entourer d'un anneau vert (ex. part terminée, collègue en ligne). */
    highlightIds?: number[];
  }>(),
  { max: 4, size: 'small', highlightIds: () => [] },
);

const visible = computed(() => props.users.slice(0, props.max));
const hidden = computed(() => props.users.slice(props.max));
</script>

<template>
  <span class="avatar-group">
    <UserAvatar
      v-for="user in visible"
      :key="user.id"
      :user="user"
      :size="size"
      :ring="highlightIds.includes(user.id) ? 'done' : 'none'"
    />
    <span v-if="hidden.length" class="more" :class="`more-${size}`" :title="hidden.map((user) => user.name).join(', ')">
      +{{ hidden.length }}
    </span>
  </span>
</template>

<style scoped>
.avatar-group {
  display: inline-flex;
  align-items: center;
}
.avatar-group > :deep(.user-avatar:not(:first-child)),
.avatar-group > .more {
  margin-left: -0.45rem;
}
.avatar-group > :deep(.user-avatar) {
  box-shadow: 0 0 0 2px var(--fb-panel);
}
.avatar-group > :deep(.user-avatar.ring-done) {
  box-shadow: 0 0 0 2px var(--fb-panel), 0 0 0 3.5px #22c55e;
}
.more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.5rem;
  height: 1.5rem;
  padding: 0 0.3rem;
  border-radius: 999px;
  background: var(--fb-panel-alt);
  color: var(--fb-muted);
  font-size: 0.65rem;
  font-weight: 700;
  box-shadow: 0 0 0 2px var(--fb-panel);
}
.more-normal {
  min-width: 2rem;
  height: 2rem;
  font-size: 0.75rem;
}
</style>
