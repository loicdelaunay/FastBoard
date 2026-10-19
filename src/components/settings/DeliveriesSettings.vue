<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import Button from 'primevue/button';
import DatePicker from 'primevue/datepicker';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Textarea from 'primevue/textarea';
import { diffDays, formatDateShort } from '@shared/dates';
import type { DeliveryDTO } from '@shared/types';
import ColorInput from '@/components/common/ColorInput.vue';
import { useProjectStore } from '@/stores/project';
import { dateToIso, isoToDate } from '@/utils/dates';
import { notifyError } from '@/utils/notify';

import { t } from '@/i18n';
const project = useProjectStore();
const confirm = useConfirm();

const canEdit = computed(() => project.can('project.edit') && !project.archived);
const dialogOpen = ref(false);
const editingId = ref<number | null>(null);
const saving = ref(false);
const form = reactive<{ name: string; description: string; start: Date | null; end: Date | null; color: string }>({
  name: '',
  description: '',
  start: null,
  end: null,
  color: '#0ea5e9',
});

const valid = computed(() => form.name.trim() !== '' && form.start !== null && form.end !== null && form.start <= form.end);

function ticketCount(delivery: DeliveryDTO): number {
  return project.tickets.filter((ticket) => ticket.deliveryId === delivery.id).length;
}

function openCreate(): void {
  editingId.value = null;
  const start = new Date();
  const end = new Date();
  end.setDate(end.getDate() + 27);
  Object.assign(form, { name: '', description: '', start, end, color: '#0ea5e9' });
  dialogOpen.value = true;
}

function openEdit(delivery: DeliveryDTO): void {
  editingId.value = delivery.id;
  Object.assign(form, {
    name: delivery.name,
    description: delivery.description,
    start: isoToDate(delivery.startDate),
    end: isoToDate(delivery.endDate),
    color: delivery.color,
  });
  dialogOpen.value = true;
}

async function save(): Promise<void> {
  if (!valid.value) {
    return;
  }
  saving.value = true;
  try {
    await project.saveDelivery(
      { name: form.name.trim(), description: form.description.trim(), startDate: dateToIso(form.start)!, endDate: dateToIso(form.end)!, color: form.color },
      editingId.value ?? undefined,
    );
    dialogOpen.value = false;
  } catch (error) {
    notifyError(error, t('Enregistrement impossible'));
  } finally {
    saving.value = false;
  }
}

function askDelete(delivery: DeliveryDTO): void {
  const count = ticketCount(delivery);
  confirm.require({
    header: t('Supprimer « {name} » ?', { name: delivery.name }),
    message: count ? t('{n} ticket ne sera plus rattaché à une livraison.|{n} tickets ne seront plus rattachés à une livraison.', { n: count }) : t('Cette livraison ne contient aucun ticket.'),
    icon: 'pi pi-trash',
    acceptLabel: t('Supprimer'),
    rejectLabel: t('Annuler'),
    acceptProps: { severity: 'danger' },
    rejectProps: { severity: 'secondary', text: true },
    accept: async () => {
      try {
        await project.deleteDelivery(delivery.id);
      } catch (error) {
        notifyError(error);
      }
    },
  });
}
</script>

<template>
  <div class="deliveries">
    <p class="muted intro">{{ $t('Une livraison regroupe des tickets entre une date de début et une date de fin. Chaque ticket peut cibler une livraison.') }}</p>

    <ul class="list">
      <li v-for="delivery in project.deliveries" :key="delivery.id" class="item card" :style="{ '--d': delivery.color }">
        <i class="stripe"></i>
        <div class="info">
          <strong>{{ delivery.name }}</strong>
          <span class="muted small">
            {{ $t('{value} → {value2} · {value3} jours · {n} ticket|{value} → {value2} · {value3} jours · {n} tickets', { n: ticketCount(delivery), value: formatDateShort(delivery.startDate, true), value2: formatDateShort(delivery.endDate, true), value3: diffDays(delivery.startDate, delivery.endDate) + 1 }) }}
          </span>
          <span v-if="delivery.description" class="muted small desc">{{ delivery.description }}</span>
        </div>
        <div v-if="canEdit" class="actions">
          <Button icon="pi pi-pencil" text rounded size="small" severity="secondary" :aria-label="$t('Modifier {name}', { name: delivery.name })" @click="openEdit(delivery)" />
          <Button icon="pi pi-trash" text rounded size="small" severity="danger" :aria-label="$t('Supprimer {name}', { name: delivery.name })" @click="askDelete(delivery)" />
        </div>
      </li>
    </ul>

    <p v-if="!project.deliveries.length" class="muted">{{ $t('Aucune livraison pour l\'instant.') }}</p>
    <Button v-if="canEdit" :label="$t('Ajouter une livraison')" icon="pi pi-plus" severity="secondary" outlined @click="openCreate" />

    <Dialog v-model:visible="dialogOpen" modal :header="editingId ? $t('Modifier la livraison') : $t('Nouvelle livraison')" :style="{ width: 'min(30rem, 96vw)' }">
      <form class="stack" @submit.prevent="save">
        <div class="field">
          <label for="d-name">{{ $t('Nom') }}</label>
          <InputText id="d-name" v-model="form.name" maxlength="100" :placeholder="$t('V1.0 — Lancement')" autofocus />
        </div>
        <div class="dates">
          <div class="field">
            <label for="d-start">{{ $t('Début') }}</label>
            <DatePicker v-model="form.start" input-id="d-start" date-format="dd/mm/yy" show-week show-icon icon-display="input" :max-date="form.end ?? undefined" />
          </div>
          <div class="field">
            <label for="d-end">{{ $t('Fin') }}</label>
            <DatePicker v-model="form.end" input-id="d-end" date-format="dd/mm/yy" show-week show-icon icon-display="input" :min-date="form.start ?? undefined" />
          </div>
        </div>
        <div class="field">
          <label>{{ $t('Couleur') }}</label>
          <ColorInput v-model="form.color" :label="$t('Couleur de la livraison')" />
        </div>
        <div class="field">
          <label for="d-desc">{{ $t('Description') }}</label>
          <Textarea id="d-desc" v-model="form.description" rows="2" auto-resize maxlength="1000" />
        </div>
        <div class="footer">
          <Button type="button" :label="$t('Annuler')" severity="secondary" text @click="dialogOpen = false" />
          <Button type="submit" :label="editingId ? $t('Enregistrer') : $t('Créer la livraison')" icon="pi pi-check" :disabled="!valid" :loading="saving" />
        </div>
      </form>
    </Dialog>
  </div>
</template>

<style scoped>
.deliveries {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1rem;
  max-width: 44rem;
}
.intro {
  margin: 0;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 100%;
  margin: 0;
  padding: 0;
  list-style: none;
}
.item {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  padding: 0.7rem 0.9rem 0.7rem 0;
  overflow: hidden;
}
.stripe {
  align-self: stretch;
  width: 6px;
  background: var(--d);
}
.info {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.desc {
  overflow-wrap: anywhere;
}
.actions {
  display: flex;
}
.dates {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}
.footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
</style>
