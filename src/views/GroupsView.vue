<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useConfirm } from 'primevue/useconfirm';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import MultiSelect from 'primevue/multiselect';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import Textarea from 'primevue/textarea';
import { DOC_ROLE_LABELS, type DocRole } from '@shared/docs';
import { GROUP_COLORS, GROUP_LIMITS, GROUP_MEMBER_ROLE_LABELS, GROUP_MEMBER_ROLES, type GroupAccessDTO, type GroupDTO, type GroupMemberRole } from '@shared/groups';
import type { UserSummaryDTO } from '@shared/types';
import { api } from '@/api';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { useAuthStore } from '@/stores/auth';
import { useGroupsStore } from '@/stores/groups';
import { notify, notifyError } from '@/utils/notify';
import { matchesQuery } from '@/utils/search';

import { t } from '@/i18n';
/**
 * Groupes de personnes : on les crée ici, puis on les ajoute d'un coup aux projets, à la documentation et aux tableaux
 * blancs (depuis leurs membres). Ajouter ou retirer quelqu'un d'un groupe lui donne ou lui reprend aussitôt ses accès.
 */
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const store = useGroupsStore();
const confirm = useConfirm();

const directory = ref<UserSummaryDTO[]>([]);
const search = ref('');
const usersById = computed(() => new Map(directory.value.map((user) => [user.id, user])));

onMounted(() => {
  void store.fetch().catch((error) => notifyError(error, t('Chargement des groupes impossible')));
  void api.directory().then((result) => (directory.value = result.users), () => undefined);
});

const visible = computed(() => {
  const query = search.value.trim();
  return store.groups.filter((group) => !query || matchesQuery(query, [group.name, group.description, ...group.members.map((member) => usersById.value.get(member.userId)?.name ?? '')]));
});
const myRole = (group: GroupDTO): GroupMemberRole | null => group.members.find((member) => member.userId === auth.user?.id)?.role ?? null;

// --- Groupe choisi (dans l'adresse) ---
const selectedId = computed(() => {
  const value = Number(route.query.group);
  return Number.isInteger(value) && value > 0 ? value : null;
});
const selected = computed(() => (selectedId.value === null ? null : (store.byId.get(selectedId.value) ?? null)));
const access = ref<GroupAccessDTO[]>([]);

function select(group: GroupDTO | null): void {
  void router.replace({ query: group ? { group: String(group.id) } : {} });
}

async function loadAccess(): Promise<void> {
  const groupId = selectedId.value;
  if (groupId === null) {
    access.value = [];
    return;
  }
  try {
    const result = await api.group(groupId);
    if (selectedId.value === groupId) access.value = result.access;
  } catch {
    access.value = [];
  }
}
watch(selectedId, () => void loadAccess(), { immediate: true });
// Le groupe a changé ailleurs (autre onglet, autre personne) : ses accès aussi, peut-être.
watch(selected, (group, previous) => {
  if (group && previous && group.updatedAt !== previous.updatedAt) void loadAccess();
});

// --- Fiche du groupe ---
const draftName = ref('');
const draftDescription = ref('');
watch(
  selected,
  (group) => {
    draftName.value = group?.name ?? '';
    draftDescription.value = group?.description ?? '';
  },
  { immediate: true },
);

async function save(patch: { name?: string; description?: string; color?: string | null }): Promise<void> {
  const group = selected.value;
  if (!group) return;
  try {
    store.upsert((await api.updateGroup(group.id, patch)).group);
  } catch (error) {
    notifyError(error, t('Groupe non enregistré'));
    draftName.value = group.name;
    draftDescription.value = group.description;
  }
}

function commitName(): void {
  const name = draftName.value.trim();
  if (selected.value && name && name !== selected.value.name) void save({ name });
  else if (selected.value) draftName.value = selected.value.name;
}

function commitDescription(): void {
  if (selected.value && draftDescription.value.trim() !== selected.value.description) void save({ description: draftDescription.value });
}

// --- Membres ---
const memberRoleOptions = computed(() => GROUP_MEMBER_ROLES.map((role) => ({ value: role, label: t(GROUP_MEMBER_ROLE_LABELS[role]) })));
const newMember = ref<number | null>(null);
const candidates = computed(() => directory.value.filter((user) => user.isActive && !selected.value?.members.some((member) => member.userId === user.id)));

async function setMember(userId: number, role: GroupMemberRole): Promise<void> {
  const group = selected.value;
  if (!group) return;
  try {
    store.upsert((await api.setGroupMember(group.id, userId, role)).group);
  } catch (error) {
    notifyError(error, t('Membre non enregistré'));
  }
}

async function addMember(): Promise<void> {
  if (newMember.value === null) return;
  await setMember(newMember.value, 'member');
  newMember.value = null;
}

function askRemove(userId: number): void {
  const group = selected.value;
  if (!group) return;
  const self = userId === auth.user?.id;
  const name = usersById.value.get(userId)?.name ?? t('Utilisateur supprimé');
  confirm.require({
    header: self ? t('Quitter le groupe « {name} » ?', { name: group.name }) : t('Retirer {name} du groupe ?', { name }),
    message: self ? t('Vous perdez aussitôt les accès que vous teniez seulement de ce groupe.') : t('Cette personne perd aussitôt les accès qu’elle tenait seulement de ce groupe.'),
    icon: 'pi pi-user-minus',
    acceptLabel: self ? t('Quitter') : t('Retirer'),
    rejectLabel: t('Annuler'),
    acceptProps: { severity: 'danger' },
    rejectProps: { severity: 'secondary', text: true },
    accept: async () => {
      try {
        const updated = (await api.removeGroupMember(group.id, userId)).group;
        store.upsert(updated);
      } catch (error) {
        notifyError(error, t('Retrait impossible'));
      }
    },
  });
}

function askDelete(): void {
  const group = selected.value;
  if (!group) return;
  confirm.require({
    header: t('Supprimer le groupe « {name} » ?', { name: group.name }),
    message: t('Ses membres perdent aussitôt les accès qu’ils tenaient seulement de ce groupe. Leurs rôles directs restent.'),
    icon: 'pi pi-trash',
    acceptLabel: t('Supprimer'),
    rejectLabel: t('Annuler'),
    acceptProps: { severity: 'danger' },
    rejectProps: { severity: 'secondary', text: true },
    accept: async () => {
      try {
        await api.deleteGroup(group.id);
        store.forget(group.id);
        select(null);
      } catch (error) {
        notifyError(error, t('Suppression impossible'));
      }
    },
  });
}

// --- Accès du groupe ---
const ACCESS_ICONS: Record<GroupAccessDTO['kind'], string> = { project: 'pi pi-th-large', docs: 'pi pi-book', boards: 'pi pi-objects-column' };
const accessRole = (entry: GroupAccessDTO) => (entry.kind === 'project' ? t(entry.role) : t(DOC_ROLE_LABELS[entry.role as DocRole] ?? entry.role));
function openAccess(entry: GroupAccessDTO): void {
  if (entry.kind === 'project') void router.push({ name: 'project', params: { projectId: entry.id } });
  else if (entry.kind === 'docs') void router.push({ name: 'doc-space', params: { spaceId: entry.id } });
  else void router.push({ name: 'board-space', params: { spaceId: entry.id } });
}

// --- Création ---
const createOpen = ref(false);
const createBusy = ref(false);
const draft = ref<{ name: string; description: string; color: string; memberIds: number[] }>({ name: '', description: '', color: GROUP_COLORS[0], memberIds: [] });
const createCandidates = computed(() => directory.value.filter((user) => user.isActive && user.id !== auth.user?.id));

function openCreate(): void {
  draft.value = { name: '', description: '', color: GROUP_COLORS[store.groups.length % GROUP_COLORS.length]!, memberIds: [] };
  createOpen.value = true;
}

async function create(): Promise<void> {
  if (!draft.value.name.trim()) return;
  createBusy.value = true;
  try {
    const { group } = await api.createGroup({ ...draft.value, name: draft.value.name.trim() });
    store.upsert(group);
    createOpen.value = false;
    select(group);
    notify('success', t('Groupe créé'), t('Ajoutez-le maintenant aux projets, à la documentation ou aux tableaux blancs, depuis leurs membres.'));
  } catch (error) {
    notifyError(error, t('Groupe non créé'));
  } finally {
    createBusy.value = false;
  }
}
</script>

<template>
  <div class="page groups-page">
    <header class="head">
      <div>
        <h1 class="page-title">{{ $t('Groupes') }}</h1>
        <p class="muted">{{ $t('Rassemblez des personnes pour les ajouter d’un coup aux projets, à la documentation et aux tableaux blancs.') }}</p>
      </div>
      <Button v-if="auth.can('groups.create')" :label="$t('Nouveau groupe')" icon="pi pi-plus" @click="openCreate" />
    </header>

    <div class="layout">
      <aside class="list-col">
        <IconField v-if="store.groups.length" class="search">
          <InputIcon class="pi pi-search" />
          <InputText v-model="search" :placeholder="$t('Rechercher un groupe ou une personne…')" fluid />
        </IconField>
        <div v-if="store.loading && !store.loaded" class="muted empty"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</div>
        <ul v-else-if="visible.length" class="groups" role="listbox" :aria-label="$t('Groupes')">
          <li v-for="group in visible" :key="group.id">
            <button type="button" class="group-row" :class="{ active: group.id === selectedId }" role="option" :aria-selected="group.id === selectedId" @click="select(group)">
              <span class="dot" :style="{ background: group.color ?? 'var(--fb-accent)' }"></span>
              <span class="group-text">
                <strong class="truncate">{{ group.name }}</strong>
                <span class="muted small">{{ $t('{n} personne|{n} personnes', { n: group.members.length }) }}</span>
              </span>
              <Tag v-if="myRole(group)" :value="$t(GROUP_MEMBER_ROLE_LABELS[myRole(group)!])" :severity="myRole(group) === 'manager' ? 'info' : 'secondary'" />
            </button>
          </li>
        </ul>
        <div v-else class="empty card">
          <i class="pi pi-users big"></i>
          <p class="muted">{{ store.groups.length ? $t('Aucun groupe ne correspond.') : $t('Aucun groupe pour l’instant.') }}</p>
        </div>
      </aside>

      <section v-if="selected" class="detail card">
        <div class="detail-head">
          <span class="dot big-dot" :style="{ background: selected.color ?? 'var(--fb-accent)' }"></span>
          <InputText v-if="selected.canManage" v-model="draftName" class="name-input" :maxlength="GROUP_LIMITS.nameMax" :aria-label="$t('Nom du groupe')" @blur="commitName" @keydown.enter.prevent="commitName" />
          <h2 v-else class="name truncate">{{ selected.name }}</h2>
          <Button v-if="selected.canManage" v-tooltip.bottom="$t('Supprimer le groupe')" icon="pi pi-trash" text rounded severity="danger" :aria-label="$t('Supprimer le groupe')" @click="askDelete" />
        </div>
        <div v-if="selected.canManage" class="colors" role="radiogroup" :aria-label="$t('Couleur du groupe')">
          <button v-for="color in GROUP_COLORS" :key="color" type="button" class="color" :class="{ on: selected.color === color }" :style="{ background: color }" role="radio" :aria-checked="selected.color === color" :aria-label="color" @click="save({ color })"></button>
        </div>
        <Textarea v-if="selected.canManage" v-model="draftDescription" rows="2" auto-resize fluid :maxlength="GROUP_LIMITS.descriptionMax" :placeholder="$t('À quoi sert ce groupe ?')" :aria-label="$t('Description du groupe')" @blur="commitDescription" />
        <p v-else-if="selected.description" class="muted">{{ selected.description }}</p>

        <h3 class="section-title"><i class="pi pi-user"></i> {{ $t('Membres') }} <span class="muted small">{{ selected.members.length }}</span></h3>
        <ul class="members">
          <li v-for="member in selected.members" :key="member.userId" class="member">
            <UserAvatar :user="usersById.get(member.userId)" />
            <span class="member-text">
              <strong class="truncate">{{ usersById.get(member.userId)?.name ?? $t('Utilisateur supprimé') }} <span v-if="member.userId === auth.user?.id" class="muted small">{{ $t('(vous)') }}</span></strong>
              <span class="muted small truncate">{{ usersById.get(member.userId)?.email }}</span>
            </span>
            <Select v-if="selected.canManage" :model-value="member.role" :options="memberRoleOptions" option-label="label" option-value="value" size="small" class="member-role" :aria-label="$t('Rôle dans le groupe')" @update:model-value="(role: GroupMemberRole) => setMember(member.userId, role)" />
            <Tag v-else :value="$t(GROUP_MEMBER_ROLE_LABELS[member.role])" severity="secondary" />
            <Button
              v-if="selected.canManage || member.userId === auth.user?.id"
              v-tooltip.top="member.userId === auth.user?.id ? $t('Quitter le groupe') : $t('Retirer du groupe')"
              :icon="member.userId === auth.user?.id ? 'pi pi-sign-out' : 'pi pi-user-minus'"
              text
              rounded
              size="small"
              severity="secondary"
              :aria-label="member.userId === auth.user?.id ? $t('Quitter le groupe') : $t('Retirer du groupe')"
              @click="askRemove(member.userId)"
            />
          </li>
        </ul>
        <form v-if="selected.canManage" class="add" @submit.prevent="addMember">
          <Select v-model="newMember" :options="candidates" option-label="name" option-value="id" filter size="small" class="grow" :placeholder="$t('Ajouter une personne…')" :aria-label="$t('Ajouter une personne')" :empty-message="$t('Tout le monde est déjà dans le groupe.')">
            <template #option="{ option }">
              <span class="option"><UserAvatar :user="option" size="small" /><span>{{ option.name }} <small class="muted">{{ option.email }}</small></span></span>
            </template>
          </Select>
          <Button type="submit" :label="$t('Ajouter')" icon="pi pi-user-plus" size="small" :disabled="newMember === null" />
        </form>
        <p class="muted small hint">{{ $t('Gestionnaire : renomme le groupe, ajoute et retire des personnes. Une personne ajoutée reçoit aussitôt les accès du groupe ; retirée, elle les perd aussitôt.') }}</p>

        <h3 class="section-title"><i class="pi pi-key"></i> {{ $t('Accès du groupe') }}</h3>
        <ul v-if="access.length" class="access">
          <li v-for="entry in access" :key="`${entry.kind}:${entry.id}`">
            <button type="button" class="access-row" @click="openAccess(entry)">
              <i :class="ACCESS_ICONS[entry.kind]" class="access-icon" :data-kind="entry.kind"></i>
              <span class="truncate grow">{{ entry.name }}</span>
              <Tag :value="accessRole(entry)" severity="secondary" />
            </button>
          </li>
        </ul>
        <p v-else class="muted small">{{ $t('Ce groupe n’a encore accès à rien que vous voyiez. Ajoutez-le depuis les membres d’un projet, d’un espace de documentation ou de tableaux blancs.') }}</p>
      </section>
      <section v-else class="detail placeholder muted">
        <i class="pi pi-users big"></i>
        <p>{{ $t('Choisissez un groupe pour voir ses membres et ses accès.') }}</p>
      </section>
    </div>

    <Dialog v-model:visible="createOpen" modal :header="$t('Nouveau groupe')" :style="{ width: 'min(30rem, calc(100vw - 2rem))' }">
      <form class="create" @submit.prevent="create">
        <label class="field-label" for="group-name">{{ $t('Nom') }}</label>
        <InputText id="group-name" v-model="draft.name" autofocus fluid :maxlength="GROUP_LIMITS.nameMax" :placeholder="$t('ex. Comptabilité, Équipe mobile…')" />
        <label class="field-label" for="group-description">{{ $t('Description') }}</label>
        <Textarea id="group-description" v-model="draft.description" rows="2" auto-resize fluid :maxlength="GROUP_LIMITS.descriptionMax" />
        <span class="field-label">{{ $t('Couleur') }}</span>
        <div class="colors">
          <button v-for="color in GROUP_COLORS" :key="color" type="button" class="color" :class="{ on: draft.color === color }" :style="{ background: color }" :aria-label="color" @click="draft.color = color"></button>
        </div>
        <label class="field-label" for="group-members">{{ $t('Membres') }}</label>
        <MultiSelect id="group-members" v-model="draft.memberIds" :options="createCandidates" option-label="name" option-value="id" filter display="chip" fluid :placeholder="$t('Choisir des personnes')" />
        <p class="muted small">{{ $t('Vous gérez le groupe que vous créez.') }}</p>
        <div class="create-actions">
          <Button type="button" :label="$t('Annuler')" severity="secondary" text @click="createOpen = false" />
          <Button type="submit" :label="$t('Créer')" icon="pi pi-check" :disabled="!draft.name.trim()" :loading="createBusy" />
        </div>
      </form>
    </Dialog>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}
.layout {
  display: grid;
  grid-template-columns: minmax(16rem, 22rem) minmax(0, 1fr);
  gap: 1.25rem;
  align-items: start;
}
.list-col {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.groups {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.group-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--fb-border);
  border-radius: 10px;
  background: var(--fb-panel);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.group-row:hover {
  border-color: var(--fb-accent);
}
.group-row.active {
  border-color: var(--fb-accent);
  box-shadow: 0 0 0 3px var(--fb-accent-soft);
}
.group-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.dot {
  width: 0.75rem;
  height: 0.75rem;
  flex: none;
  border-radius: 50%;
}
.big-dot {
  width: 1rem;
  height: 1rem;
}
.detail {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1.1rem 1.25rem;
}
.detail.placeholder {
  align-items: center;
  justify-content: center;
  min-height: 16rem;
  text-align: center;
}
.detail-head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.name-input {
  flex: 1;
  font-size: 1.1rem;
  font-weight: 700;
}
.name {
  flex: 1;
  margin: 0;
  font-size: 1.2rem;
}
.colors {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.color {
  width: 1.4rem;
  height: 1.4rem;
  padding: 0;
  border: 2px solid var(--fb-border);
  border-radius: 50%;
  cursor: pointer;
}
.color.on {
  outline: 2px solid var(--fb-text);
  outline-offset: 2px;
}
.section-title {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0.6rem 0 0;
  font-size: 0.95rem;
}
.members,
.access {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.member {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.member-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.member-role {
  width: 10rem;
}
.add {
  display: flex;
  align-items: center;
  gap: 0.5rem;
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
.hint {
  margin: 0;
}
.access-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  padding: 0.45rem 0.6rem;
  border: 0;
  border-radius: 8px;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.access-row:hover {
  background: var(--fb-panel-alt);
}
.access-icon[data-kind='project'] {
  color: var(--fb-module-projects);
}
.access-icon[data-kind='docs'] {
  color: var(--fb-module-docs);
}
.access-icon[data-kind='boards'] {
  color: var(--fb-module-boards);
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  padding: 1.5rem;
  text-align: center;
}
.big {
  font-size: 1.8rem;
  color: var(--fb-muted);
}
.create {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.field-label {
  font-size: 0.85rem;
  font-weight: 600;
}
.create p {
  margin: 0;
}
.create-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
@media (max-width: 800px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
