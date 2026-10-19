<script setup lang="ts">
import { computed } from 'vue';
import Avatar from 'primevue/avatar';
import type { UserSummaryDTO } from '@shared/types';
import { avatarColor, avatarUrl, initials } from '@/utils/user';

const props = withDefaults(
  defineProps<{
    user: Pick<UserSummaryDTO, 'id' | 'name' | 'avatarVersion'> | null | undefined;
    size?: 'small' | 'normal' | 'large' | 'xlarge';
    ring?: 'none' | 'done' | 'online';
  }>(),
  { size: 'normal', ring: 'none' },
);

const image = computed(() => avatarUrl(props.user));
const label = computed(() => initials(props.user?.name));
const background = computed(() => (props.user ? avatarColor(props.user.id) : '#94a3b8'));
</script>

<template>
  <span class="user-avatar" :class="[`ring-${ring}`]" :title="user?.name ?? $t('Utilisateur supprimé')">
    <Avatar
      :image="image ?? undefined"
      :label="image ? undefined : label"
      shape="circle"
      :size="size === 'small' ? undefined : size"
      :class="{ 'avatar-small': size === 'small' }"
      :style="image ? undefined : { background, color: '#fff' }"
    />
  </span>
</template>

<style scoped>
.user-avatar {
  display: inline-flex;
  border-radius: 50%;
  flex: none;
  position: relative;
}
.avatar-small {
  width: 1.5rem;
  height: 1.5rem;
  font-size: 0.65rem;
}
.ring-done {
  box-shadow: 0 0 0 2px var(--fb-panel), 0 0 0 4px #22c55e;
}
.ring-online {
  box-shadow: 0 0 0 2px var(--fb-panel), 0 0 0 4px #22c55e;
}
</style>
