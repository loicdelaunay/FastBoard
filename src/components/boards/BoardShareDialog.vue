<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import MultiSelect from 'primevue/multiselect';
import Password from 'primevue/password';
import RadioButton from 'primevue/radiobutton';
import SelectButton from 'primevue/selectbutton';
import { useConfirm } from 'primevue/useconfirm';
import { BOARD_SHARE_LIMITS, boardTitle, type BoardNodeDTO, type BoardShareAudience, type BoardShareDTO, type BoardShareRole } from '@shared/boards';
import type { UserSummaryDTO } from '@shared/types';
import { api } from '@/api';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { t } from '@/i18n';
import { copyText } from '@/utils/docRender';
import { notify, notifyError } from '@/utils/notify';

/**
 * Partage d'un tableau en plus des membres de son espace : aux personnes connectées, à une liste, ou à tout le monde
 * sans compte, en lecture ou en écriture, avec un mot de passe au choix.
 */
const props = defineProps<{ board: BoardNodeDTO | null; users: UserSummaryDTO[] }>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ saved: [] }>();

const confirm = useConfirm();
const share = ref<BoardShareDTO | null>(null);
const audience = ref<BoardShareAudience>('users');
const people = ref<number[]>([]);
const role = ref<BoardShareRole>('reader');
/** Mot de passe : inchangé, nouveau, ou retiré. */
const passwordMode = ref<'keep' | 'set' | 'none'>('none');
const password = ref('');
const loading = ref(false);
const saving = ref(false);

const OPTIONS = computed<Array<{ value: BoardShareAudience; label: string; hint: string; icon: string }>>(() => [
  { value: 'users', label: t('Toutes les personnes connectées'), hint: t('Toute personne qui a un compte et l’adresse, même hors de l’espace.'), icon: 'pi pi-users' },
  { value: 'people', label: t('Personnes choisies'), hint: t('Seulement les personnes listées, avec leur compte.'), icon: 'pi pi-user-plus' },
  { value: 'public', label: t('Tout le monde, sans compte'), hint: t('Toute personne qui a l’adresse, même anonyme : elle choisit le nom affiché à côté de son curseur.'), icon: 'pi pi-globe' },
]);
const ROLES = computed(() => [
  { value: 'reader', label: t('Voir en direct') },
  { value: 'editor', label: t('Modifier') },
]);
const url = computed(() => (share.value ? `${window.location.origin}/t/${share.value.slug}` : ''));
const candidates = computed(() => props.users.filter((user) => user.isActive));
const passwordValid = computed(() => passwordMode.value !== 'set' || password.value.trim().length >= BOARD_SHARE_LIMITS.passwordMin);

watch(visible, async (open) => {
  if (!open || !props.board) return;
  loading.value = true;
  share.value = null;
  password.value = '';
  try {
    share.value = (await api.boardShare(props.board.id)).share;
    audience.value = share.value?.audience ?? 'users';
    people.value = share.value?.people ?? [];
    role.value = share.value?.role ?? 'reader';
    passwordMode.value = share.value?.hasPassword ? 'keep' : 'none';
  } catch (error) {
    notifyError(error);
  } finally {
    loading.value = false;
  }
}, { immediate: true });

async function save(): Promise<void> {
  if (!props.board) return;
  saving.value = true;
  try {
    const password_ = passwordMode.value === 'keep' ? undefined : passwordMode.value === 'set' ? password.value.trim() : null;
    share.value = (await api.boardSaveShare(props.board.id, { audience: audience.value, people: audience.value === 'people' ? people.value : [], role: role.value, password: password_ })).share;
    passwordMode.value = share.value.hasPassword ? 'keep' : 'none';
    password.value = '';
    notify('success', t('Tableau partagé'), t('Copiez l’adresse pour l’envoyer.'));
    emit('saved');
  } catch (error) {
    notifyError(error, t('Partage non enregistré'));
  } finally {
    saving.value = false;
  }
}

async function copy(): Promise<void> {
  await copyText(url.value);
  notify('success', t('Adresse copiée'));
}

function askRemove(): void {
  if (!props.board) return;
  const id = props.board.id;
  confirm.require({
    header: t('Ne plus partager ce tableau ?'),
    message: t('L’adresse cesse de fonctionner, et ceux qui sont entrés par elle sortent du tableau. Les membres de l’espace gardent leur accès.'),
    icon: 'pi pi-times',
    acceptLabel: t('Ne plus partager'),
    rejectLabel: t('Annuler'),
    acceptProps: { severity: 'danger' },
    rejectProps: { severity: 'secondary', text: true },
    accept: async () => {
      try {
        await api.boardRemoveShare(id);
        share.value = null;
        emit('saved');
        visible.value = false;
      } catch (error) {
        notifyError(error);
      }
    },
  });
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="board ? $t('Partager « {name} »', { name: boardTitle(board.path) }) : $t('Partager')" :style="{ width: 'min(34rem, calc(100vw - 2rem))' }">
    <div v-if="loading" class="muted"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</div>
    <div v-else class="stack">
      <p class="muted small intro">{{ $t('Les membres de l’espace gardent leurs droits. Le partage donne un accès en plus, par une adresse à envoyer.') }}</p>

      <fieldset class="choices">
        <legend class="small strong">{{ $t('À qui ?') }}</legend>
        <label v-for="option in OPTIONS" :key="option.value" class="choice" :class="{ active: audience === option.value, open: option.value === 'public' }">
          <RadioButton v-model="audience" :value="option.value" :input-id="`share-${option.value}`" />
          <i :class="option.icon"></i>
          <span class="choice-text">
            <strong>{{ option.label }}</strong>
            <span class="muted small">{{ option.hint }}</span>
          </span>
        </label>
      </fieldset>

      <div v-if="audience === 'people'" class="field">
        <label for="share-people" class="small strong">{{ $t('Personnes') }}</label>
        <MultiSelect id="share-people" v-model="people" :options="candidates" option-label="name" option-value="id" filter display="chip" fluid :placeholder="$t('Choisir des personnes')">
          <template #option="{ option }"><span class="person"><UserAvatar :user="option" size="small" /> {{ option.name }}</span></template>
        </MultiSelect>
      </div>

      <div class="field">
        <span class="small strong">{{ $t('Droits') }}</span>
        <SelectButton v-model="role" :options="ROLES" option-label="label" option-value="value" :allow-empty="false" size="small" />
      </div>

      <div class="field">
        <span class="small strong">{{ $t('Mot de passe') }}</span>
        <template v-if="passwordMode === 'keep'">
          <div class="password-set">
            <span class="small"><i class="pi pi-lock"></i> {{ $t('Un mot de passe protège ce partage.') }}</span>
            <Button :label="$t('Changer')" size="small" text @click="passwordMode = 'set'" />
            <Button :label="$t('Retirer')" size="small" severity="secondary" text @click="passwordMode = 'none'" />
          </div>
        </template>
        <template v-else>
          <div class="password-check">
            <input id="share-password" type="checkbox" :checked="passwordMode === 'set'" @change="passwordMode = ($event.target as HTMLInputElement).checked ? 'set' : 'none'" />
            <label for="share-password" class="small">{{ $t('Protéger par un mot de passe') }}</label>
          </div>
          <Password v-if="passwordMode === 'set'" v-model="password" :feedback="false" toggle-mask fluid :placeholder="$t('Au moins {n} caractères', { n: BOARD_SHARE_LIMITS.passwordMin })" :input-props="{ autocomplete: 'new-password' }" />
          <span v-if="share?.hasPassword && passwordMode !== 'set'" class="muted small">{{ $t('Le mot de passe sera retiré à l’enregistrement.') }}</span>
        </template>
      </div>

      <div v-if="share" class="address">
        <i class="pi pi-link muted"></i>
        <a :href="url" target="_blank" rel="noopener" class="truncate">{{ url }}</a>
        <Button v-tooltip.top="$t('Copier l’adresse')" icon="pi pi-copy" text rounded size="small" :aria-label="$t('Copier l’adresse')" @click="copy" />
      </div>
    </div>

    <template #footer>
      <Button v-if="share" :label="$t('Ne plus partager')" icon="pi pi-times" severity="danger" text class="left" @click="askRemove" />
      <Button :label="$t('Fermer')" severity="secondary" text @click="visible = false" />
      <Button :label="share ? $t('Enregistrer') : $t('Partager')" icon="pi pi-share-alt" :loading="saving" :disabled="loading || !passwordValid || (audience === 'people' && !people.length)" @click="save" />
    </template>
  </Dialog>
</template>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.intro {
  margin: 0;
}
.choices {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0;
  padding: 0;
  border: 0;
}
.choices legend {
  margin-bottom: 0.4rem;
  padding: 0;
}
.strong {
  font-weight: 700;
}
.choice {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--fb-border);
  border-radius: 8px;
  cursor: pointer;
}
.choice.active {
  border-color: var(--fb-accent);
  background: var(--fb-accent-soft);
}
.choice.open.active {
  border-color: #f59e0b;
  background: color-mix(in srgb, #f59e0b 10%, transparent);
}
.choice > .pi {
  color: var(--fb-muted);
}
.choice-text {
  display: flex;
  flex-direction: column;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.person {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.password-set,
.password-check {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.password-check {
  cursor: pointer;
}
.address {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.3rem 0.3rem 0.7rem;
  border-radius: 8px;
  background: var(--fb-panel-alt);
}
.address a {
  flex: 1;
  min-width: 0;
  font-size: 0.88rem;
}
.left {
  margin-right: auto;
}
</style>
