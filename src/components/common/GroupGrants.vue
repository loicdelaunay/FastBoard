<script setup lang="ts" generic="R extends string | number">
import { computed, onMounted, ref, watch } from 'vue';
import Button from 'primevue/button';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import type { UserSummaryDTO } from '@shared/types';
import { useGroupsStore } from '@/stores/groups';

import { t } from '@/i18n';
/**
 * Groupes ajoutés à un projet ou à un espace, comme dans Google Drive : chaque groupe donne son rôle à ses membres, et
 * un rôle donné directement à une personne s'y ajoute (le plus large l'emporte).
 */
const props = defineProps<{
  grants: Array<{ groupId: number; name: string; color: string | null; memberIds: number[]; role: R }>;
  roleOptions: Array<{ value: R; label: string }>;
  editable: boolean;
  /** Personnes connues, pour nommer les membres d'un groupe au survol. */
  users: UserSummaryDTO[];
  defaultRole: R;
  /** Rôles qu'on ne peut pas changer (plus larges que les siens). */
  locked?: (role: R) => boolean;
}>();
const emit = defineEmits<{ set: [groupId: number, role: R]; remove: [groupId: number] }>();

const store = useGroupsStore();
const newGroup = ref<number | null>(null);
const newRole = ref<R>(props.defaultRole) as { value: R };
watch(
  () => props.defaultRole,
  (role) => (newRole.value = role),
);

onMounted(() => {
  if (props.editable) void store.ensure().catch(() => undefined);
});

const candidates = computed(() => store.groups.filter((group) => !props.grants.some((grant) => grant.groupId === group.id)));
const nameOf = (userId: number) => props.users.find((user) => user.id === userId)?.name ?? t('Utilisateur supprimé');
const roleLabel = (role: R) => props.roleOptions.find((option) => option.value === role)?.label ?? String(role);
const membersHint = (memberIds: number[]) => (memberIds.length ? memberIds.map(nameOf).join(', ') : t('Aucun membre pour l’instant.'));

function add(): void {
  if (newGroup.value === null) return;
  emit('set', newGroup.value, newRole.value);
  newGroup.value = null;
}
</script>

<template>
  <section class="group-grants">
    <h4 class="title"><i class="pi pi-users"></i> {{ $t('Groupes') }}</h4>
    <ul v-if="grants.length" class="grants">
      <li v-for="grant in grants" :key="grant.groupId" class="grant">
        <span class="dot" :style="{ background: grant.color ?? 'var(--fb-accent)' }"></span>
        <span class="name">
          <strong class="truncate">{{ grant.name }}</strong>
          <span v-tooltip.top="membersHint(grant.memberIds)" class="muted small members" tabindex="0">{{ $t('{n} personne|{n} personnes', { n: grant.memberIds.length }) }}</span>
        </span>
        <template v-if="editable && !locked?.(grant.role)">
          <Select :model-value="grant.role" :options="roleOptions" option-label="label" option-value="value" size="small" class="role" :aria-label="$t('Rôle du groupe {name}', { name: grant.name })" @update:model-value="(role: R) => emit('set', grant.groupId, role)" />
          <Button v-tooltip.top="$t('Retirer le groupe')" icon="pi pi-times" text rounded size="small" severity="secondary" :aria-label="$t('Retirer le groupe {name}', { name: grant.name })" @click="emit('remove', grant.groupId)" />
        </template>
        <Tag v-else :value="roleLabel(grant.role)" severity="secondary" />
      </li>
    </ul>
    <p v-else class="muted small empty">{{ $t('Aucun groupe n’a accès.') }}</p>

    <form v-if="editable" class="add" @submit.prevent="add">
      <Select v-model="newGroup" :options="candidates" option-label="name" option-value="id" filter size="small" class="grow" :placeholder="$t('Ajouter un groupe…')" :aria-label="$t('Ajouter un groupe')" :empty-message="$t('Aucun autre groupe. Créez-en dans « Groupes ».')">
        <template #option="{ option }">
          <span class="option"><span class="dot" :style="{ background: option.color ?? 'var(--fb-accent)' }"></span>{{ option.name }} <small class="muted">{{ $t('{n} personne|{n} personnes', { n: option.members.length }) }}</small></span>
        </template>
      </Select>
      <Select v-model="newRole" :options="roleOptions" option-label="label" option-value="value" size="small" class="role" :aria-label="$t('Rôle')" />
      <Button type="submit" icon="pi pi-plus" size="small" :disabled="newGroup === null" :aria-label="$t('Ajouter')" />
    </form>
    <p class="muted small hint">{{ $t('Les membres d’un groupe ont accès avec son rôle. Un rôle donné en plus à une personne s’y ajoute : le plus large l’emporte.') }}</p>
  </section>
</template>

<style scoped>
.group-grants {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.title {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0;
  font-size: 0.9rem;
}
.grants {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.grant,
.add {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.dot {
  width: 0.7rem;
  height: 0.7rem;
  flex: none;
  border-radius: 50%;
}
.name {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.members {
  align-self: flex-start;
  cursor: help;
}
.role {
  width: 10rem;
}
.grow {
  flex: 1;
  min-width: 0;
}
.option {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}
.empty,
.hint {
  margin: 0;
}
</style>
