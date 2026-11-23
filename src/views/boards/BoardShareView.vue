<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Password from 'primevue/password';
import { BOARD_SHARE_LIMITS, type BoardShareInfoDTO } from '@shared/boards';
import { docRoleAtLeast } from '@shared/docs';
import type { UserSummaryDTO } from '@shared/types';
import { api } from '@/api';
import { ApiError } from '@/api/http';
import BoardCanvas from '@/components/boards/BoardCanvas.vue';
import { useFollow } from '@/composables/useFollow';
import { t } from '@/i18n';
import { BoardSession } from '@/realtime/boardSession';
import { realtime } from '@/realtime/socket';
import { useAppStore } from '@/stores/app';
import { useAuthStore } from '@/stores/auth';
import { notifyError } from '@/utils/notify';

/**
 * Tableau ouvert par son lien de partage : membres, personnes invitées, ou visiteurs sans compte qui choisissent le nom
 * affiché à côté de leur curseur. Tout se dessine et se suit en direct, selon les droits du partage.
 */
const route = useRoute();
const router = useRouter();
const app = useAppStore();
const auth = useAuthStore();

const slug = computed(() => String(route.params.slug));
const TOKEN_KEY = computed(() => `fb.boardShare.${slug.value}`);
const NAME_KEY = 'fb.guest.name';
const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string | null): void => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Sans stockage, il faudra le redonner à la prochaine visite.
  }
};

const state = ref<'loading' | 'login' | 'password' | 'forbidden' | 'missing' | 'name' | 'ready'>('loading');
const info = ref<BoardShareInfoDTO | null>(null);
const token = ref<string | null>(read(TOKEN_KEY.value));
const password = ref('');
const passwordError = ref('');
const busy = ref(false);
const guestName = ref(read(NAME_KEY) ?? '');
const users = ref<UserSummaryDTO[]>([]);
const session = shallowRef<BoardSession | null>(null);
const guestId = 900_000 + Math.floor(Math.random() * 99_999);
/** Personnes sur ce tableau ; un clic sur l'une d'elles suit ce qu'elle regarde. */
const follow = useFollow({ self: () => auth.user?.id ?? guestId });
const presence = follow.people;

// Les droits suivent le partage en direct : une fois raccordé, c'est le serveur qui dit si l'on peut écrire.
const canEdit = computed(() => (session.value?.synced.value ? session.value.canWrite.value : Boolean(info.value && docRoleAtLeast(info.value.role, 'editor'))));

async function load(): Promise<void> {
  state.value = 'loading';
  try {
    info.value = (await api.sharedBoard(slug.value, token.value)).share;
    document.title = `${info.value.title} · ${app.name}`;
    if (!auth.isAuthenticated && !guestName.value.trim()) state.value = 'name';
    else start();
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 0;
    const code = error instanceof ApiError ? error.code : '';
    if (code === 'board_password') {
      if (token.value) write(TOKEN_KEY.value, null);
      token.value = null;
      state.value = 'password';
    } else if (status === 401) state.value = 'login';
    else if (status === 403) state.value = 'forbidden';
    else state.value = 'missing';
  }
}

function start(): void {
  if (!info.value) return;
  if (!auth.isAuthenticated) realtime.connect({ guest: true });
  else void api.directory().then((result) => (users.value = result.users), () => undefined);
  const user = auth.user ? { id: auth.user.id, name: auth.user.name } : { id: guestId, name: guestName.value.trim().slice(0, BOARD_SHARE_LIMITS.guestNameMax) };
  follow.detach();
  session.value?.close();
  const next = new BoardSession(info.value.boardId, user, { slug: slug.value, token: token.value });
  follow.attach(next.awareness, next.doc.clientID);
  session.value = next;
  state.value = 'ready';
}

async function unlock(): Promise<void> {
  if (!password.value) return;
  busy.value = true;
  passwordError.value = '';
  try {
    token.value = (await api.sharedBoardUnlock(slug.value, password.value)).token;
    write(TOKEN_KEY.value, token.value);
    password.value = '';
    await load();
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 429)) passwordError.value = error.message;
    else notifyError(error);
  } finally {
    busy.value = false;
  }
}

function enter(): void {
  const name = guestName.value.trim();
  if (!name) return;
  write(NAME_KEY, name);
  start();
}

/** Le visiteur change le nom affiché à côté de son curseur. */
function rename(): void {
  const name = window.prompt(t('Votre nom, affiché à côté de votre curseur :'), guestName.value);
  if (!name?.trim() || !session.value) return;
  guestName.value = name.trim().slice(0, BOARD_SHARE_LIMITS.guestNameMax);
  write(NAME_KEY, guestName.value);
  const current = session.value.awareness.getLocalState()?.user as Record<string, unknown> | undefined;
  session.value.awareness.setLocalStateField('user', { ...current, name: guestName.value });
}

// Partage retiré, mot de passe ajouté ou changé, tableau supprimé : on redemande l'accès (mot de passe, refus…).
watch(
  () => session.value?.closed.value,
  (reason) => {
    if (!reason) return;
    follow.detach();
    session.value?.close();
    session.value = null;
    if (!auth.isAuthenticated) realtime.disconnect();
    void load();
  },
);

function login(): void {
  void router.push({ name: 'login', query: { redirect: route.fullPath } });
}

onMounted(load);
onBeforeUnmount(() => {
  session.value?.close();
  // Un visiteur sans compte n'a plus rien à suivre.
  if (!auth.isAuthenticated) realtime.disconnect();
});
</script>

<template>
  <div class="shared">
    <header class="bar">
      <img :src="app.logoUrl" alt="" width="26" height="26" class="logo" />
      <div class="title">
        <strong class="truncate">{{ info?.title ?? app.name }}</strong>
        <span v-if="info" class="muted small truncate">{{ info.spaceName }}</span>
      </div>
      <span v-if="state === 'ready'" class="role" :class="{ edit: canEdit }">
        <i :class="canEdit ? 'pi pi-pencil' : 'pi pi-eye'"></i> {{ canEdit ? $t('Modification') : $t('Lecture seule') }}
      </span>
      <span class="spacer"></span>
      <div v-if="presence.length" class="people">
        <button
          v-for="person in presence"
          :key="person.id"
          v-tooltip.bottom="follow.label(person, person.name)"
          type="button"
          class="person"
          :class="{ followed: follow.following.value === person.id }"
          :style="{ backgroundColor: person.color, '--ring': person.color }"
          :aria-label="follow.label(person, person.name)"
          :aria-pressed="follow.following.value === person.id"
          @click="follow.toggle(person)"
        >
          {{ person.name.slice(0, 1).toUpperCase() }}
          <i v-if="follow.following.value === person.id || person.followsMe" class="pi pi-eye watch" :class="{ me: person.followsMe && follow.following.value !== person.id }" aria-hidden="true"></i>
        </button>
      </div>
      <Button v-if="state === 'ready' && !auth.isAuthenticated" v-tooltip.bottom="$t('Changer de nom')" :label="guestName" icon="pi pi-user" size="small" severity="secondary" text @click="rename" />
      <Button v-if="info?.member && info.spaceId" :label="$t('Ouvrir dans {name}', { name: app.name })" icon="pi pi-external-link" size="small" severity="secondary" outlined @click="router.push({ name: 'board-space', params: { spaceId: info.spaceId }, query: { board: String(info.boardId) } })" />
      <Button v-else-if="!auth.isAuthenticated" :label="$t('Se connecter')" icon="pi pi-sign-in" size="small" severity="secondary" text @click="login" />
    </header>

    <BoardCanvas v-if="state === 'ready' && session && info" :key="session.boardId" :session="session" :can-edit="canEdit" :users="users" :board-title="info.title" v-model:follow="follow.following.value" />

    <div v-else class="gate">
      <div v-if="state === 'loading'" class="muted"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</div>

      <form v-else-if="state === 'name'" class="card panel" @submit.prevent="enter">
        <i class="pi pi-user icon"></i>
        <h2>{{ $t('Comment vous appelez-vous ?') }}</h2>
        <p class="muted small">{{ $t('Votre nom s’affiche à côté de votre curseur pour les autres personnes du tableau.') }}</p>
        <InputText v-model="guestName" :maxlength="BOARD_SHARE_LIMITS.guestNameMax" autofocus fluid :placeholder="$t('Votre nom')" :aria-label="$t('Votre nom')" />
        <Button type="submit" :label="$t('Ouvrir le tableau')" icon="pi pi-arrow-right" icon-pos="right" :disabled="!guestName.trim()" />
        <Button :label="$t('J’ai un compte : me connecter')" size="small" severity="secondary" text @click="login" />
      </form>

      <form v-else-if="state === 'password'" class="card panel" @submit.prevent="unlock">
        <i class="pi pi-lock icon"></i>
        <h2>{{ $t('Tableau protégé') }}</h2>
        <p class="muted small">{{ $t('Saisissez le mot de passe donné avec l’adresse.') }}</p>
        <Password v-model="password" :feedback="false" toggle-mask fluid autofocus :placeholder="$t('Mot de passe')" :input-props="{ autocomplete: 'current-password', 'aria-label': $t('Mot de passe') }" />
        <p v-if="passwordError" class="error small">{{ passwordError }}</p>
        <Button type="submit" :label="$t('Ouvrir le tableau')" icon="pi pi-unlock" :loading="busy" :disabled="!password" />
      </form>

      <div v-else class="card panel">
        <i :class="state === 'login' ? 'pi pi-sign-in' : state === 'forbidden' ? 'pi pi-ban' : 'pi pi-question-circle'" class="icon"></i>
        <h2>{{ state === 'login' ? $t('Connectez-vous pour ouvrir ce tableau') : state === 'forbidden' ? $t('Ce tableau n’est pas partagé avec vous') : $t('Tableau introuvable') }}</h2>
        <p class="muted small">{{ state === 'login' ? $t('Il est partagé avec des personnes qui ont un compte.') : state === 'forbidden' ? $t('Demandez l’accès à la personne qui vous a envoyé l’adresse.') : $t('L’adresse est peut-être erronée, ou le partage a été retiré.') }}</p>
        <Button v-if="state === 'login'" :label="$t('Se connecter')" icon="pi pi-sign-in" @click="login" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.shared {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  height: 100dvh;
  background: var(--board-canvas);
}
.bar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  height: 3.25rem;
  flex: none;
  padding: 0 0.9rem;
  border-bottom: 1px solid var(--fb-border);
  background: var(--fb-panel);
}
.logo {
  flex: none;
  border-radius: 6px;
  object-fit: contain;
}
.title {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.2;
}
.role {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  background: var(--fb-panel-alt);
  color: var(--fb-muted);
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
}
.role.edit {
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
}
.spacer {
  flex: 1;
}
.people {
  display: flex;
}
.person {
  position: relative;
  display: grid;
  place-items: center;
  width: 1.8rem;
  height: 1.8rem;
  padding: 0;
  border: 2px solid var(--fb-panel);
  border-radius: 999px;
  color: #fff;
  font: inherit;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
}
.person.followed {
  z-index: 1;
  box-shadow: 0 0 0 2px var(--ring);
}
.person .watch {
  position: absolute;
  right: -4px;
  bottom: -4px;
  display: grid;
  place-items: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--ring);
  color: #fff;
  font-size: 9px;
  box-shadow: 0 0 0 1.5px var(--fb-panel);
}
.person .watch.me {
  background: var(--fb-panel);
  color: var(--fb-muted);
}
.person + .person {
  margin-left: -0.4rem;
}
.gate {
  display: grid;
  flex: 1;
  place-items: center;
  padding: 1rem;
}
.panel {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.6rem;
  width: min(24rem, 100%);
  padding: 1.5rem;
  text-align: center;
}
.panel h2 {
  margin: 0;
  font-size: 1.2rem;
}
.panel p {
  margin: 0;
}
.icon {
  color: #a855f7;
  font-size: 1.8rem;
}
.error {
  color: var(--fb-danger);
}
</style>
