<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import MultiSelect from 'primevue/multiselect';
import RadioButton from 'primevue/radiobutton';
import type { DocSiteDTO, DocSiteVisibility, DocSpaceDTO } from '@shared/docs';
import type { UserSummaryDTO } from '@shared/types';
import { api } from '@/api';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { copyText } from '@/utils/docRender';
import { notify, notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/** Site web d'un espace : un wiki en lecture seule, ouvert aux membres, à des personnes choisies ou à tout le monde. */
const props = defineProps<{ space: DocSpaceDTO | null }>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ saved: [] }>();

const confirm = useConfirm();
const site = ref<DocSiteDTO | null>(null);
const visibility = ref<DocSiteVisibility>('members');
const people = ref<number[]>([]);
const users = ref<UserSummaryDTO[]>([]);
const loading = ref(false);
const saving = ref(false);

const OPTIONS = computed<Array<{ value: DocSiteVisibility; label: string; hint: string; icon: string }>>(() => [
  { value: 'members', label: t('Membres de l’espace'), hint: t('Il faut un compte et un rôle dans cet espace.'), icon: 'pi pi-users' },
  { value: 'people', label: t('Personnes choisies'), hint: t('Seulement les personnes listées, même hors de l’espace, et ses propriétaires.'), icon: 'pi pi-user-plus' },
  { value: 'public', label: t('Tout le monde'), hint: t('Sans compte : toute personne qui a l’adresse peut lire le site.'), icon: 'pi pi-globe' },
]);
const url = computed(() => (site.value ? `${window.location.origin}/wiki/${site.value.slug}` : ''));
const changed = computed(() => !site.value || site.value.visibility !== visibility.value || site.value.people.join() !== people.value.join());

watch(visible, async (open) => {
  if (!open || !props.space) return;
  loading.value = true;
  site.value = null;
  try {
    const [current, directory] = await Promise.all([api.docSite(props.space.id), api.directory()]);
    site.value = current.site;
    users.value = directory.users.filter((user) => user.isActive);
    visibility.value = current.site?.visibility ?? 'members';
    people.value = current.site?.people ?? [];
  } catch (error) {
    notifyError(error);
  } finally {
    loading.value = false;
  }
});

async function save(): Promise<void> {
  if (!props.space) return;
  saving.value = true;
  try {
    const first = !site.value;
    site.value = (await api.docSaveSite(props.space.id, { visibility: visibility.value, people: visibility.value === 'people' ? people.value : [] })).site;
    people.value = site.value.people;
    notify('success', first ? t('Site web activé') : t('Site web modifié'));
    emit('saved');
  } catch (error) {
    notifyError(error, t('Site web non enregistré'));
  } finally {
    saving.value = false;
  }
}

function askRemove(): void {
  const space = props.space;
  if (!space) return;
  confirm.require({
    header: t('Désactiver le site web ?'),
    message: t('L’adresse cesse de fonctionner. Réactivé plus tard, le site aura une nouvelle adresse.'),
    icon: 'pi pi-globe',
    acceptLabel: t('Désactiver'),
    rejectLabel: t('Annuler'),
    acceptProps: { severity: 'danger' },
    rejectProps: { severity: 'secondary', text: true },
    accept: async () => {
      try {
        await api.docRemoveSite(space.id);
        site.value = null;
        notify('success', t('Site web désactivé'));
        emit('saved');
        visible.value = false;
      } catch (error) {
        notifyError(error);
      }
    },
  });
}

async function copy(): Promise<void> {
  await copyText(url.value);
  notify('success', t('Adresse copiée'));
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="site ? $t('Site web de l’espace') : $t('Activer le site web')" :style="{ width: 'min(32rem, calc(100vw - 2rem))' }">
    <div v-if="loading" class="muted"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</div>
    <div v-else class="stack">
      <p class="muted small intro">{{ $t('Le site présente les notes de l’espace comme un wiki, en lecture seule, et suit leurs modifications en direct.') }}</p>

      <fieldset class="choices">
        <legend class="small strong">{{ $t('Qui peut le lire ?') }}</legend>
        <label v-for="option in OPTIONS" :key="option.value" class="choice" :class="{ active: visibility === option.value, open: option.value === 'public' }">
          <RadioButton v-model="visibility" :value="option.value" :input-id="`site-${option.value}`" />
          <i :class="option.icon"></i>
          <span class="choice-text">
            <strong>{{ option.label }}</strong>
            <span class="muted small">{{ option.hint }}</span>
          </span>
        </label>
      </fieldset>

      <div v-if="visibility === 'people'" class="field">
        <label for="site-people" class="small strong">{{ $t('Personnes') }}</label>
        <MultiSelect id="site-people" v-model="people" :options="users" option-label="name" option-value="id" filter display="chip" fluid :placeholder="$t('Choisir des personnes')">
          <template #option="{ option }"><span class="person"><UserAvatar :user="option" size="small" /> {{ option.name }}</span></template>
        </MultiSelect>
      </div>

      <div v-if="site" class="address">
        <i class="pi pi-link muted"></i>
        <a :href="url" target="_blank" rel="noopener" class="truncate">{{ url }}</a>
        <Button v-tooltip.top="$t('Copier l’adresse')" icon="pi pi-copy" text rounded size="small" :aria-label="$t('Copier l’adresse')" @click="copy" />
      </div>
    </div>

    <template #footer>
      <Button v-if="site" :label="$t('Désactiver')" icon="pi pi-times" severity="danger" text class="left" @click="askRemove" />
      <Button :label="$t('Fermer')" severity="secondary" text @click="visible = false" />
      <Button :label="site ? $t('Enregistrer') : $t('Activer le site')" icon="pi pi-check" :loading="saving" :disabled="loading || !changed || (visibility === 'people' && !people.length)" @click="save" />
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
