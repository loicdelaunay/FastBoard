<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import { CHART_KINDS, type ChartElement, type ChartKind, type TableElement } from '@shared/boards';
import { t } from '@/i18n';
import BoardChart from './BoardChart.vue';

/**
 * Réglages et données d'un graphique : type, titre, et la grille de valeurs (ou celle du tableau dont il dépend), avec
 * l'aperçu du graphique qui suit chaque saisie.
 */
const props = defineProps<{ element: ChartElement; source: TableElement | null; editable: boolean }>();
const emit = defineEmits<{ close: []; save: [patch: Partial<ChartElement>]; 'save-source': [rows: string[][]] }>();

const visible = ref(true);
const title = ref(props.element.title);
const chart = ref<ChartKind>(props.element.chart);
const rows = ref<string[][]>((props.source?.rows ?? props.element.rows).map((row) => [...row]));
const linked = ref(Boolean(props.source));

watch(visible, (value) => !value && emit('close'));

const LABELS: Record<ChartKind, string> = { bar: 'Barres', line: 'Courbes', pie: 'Camembert', doughnut: 'Anneau', radar: 'Radar' };
const kinds = computed(() => CHART_KINDS.map((kind) => ({ value: kind, label: t(LABELS[kind]) })));
const columns = computed(() => rows.value[0]?.length ?? 0);
/** Le graphique tel qu'il sera enregistré : titre, type et valeurs en cours de saisie. */
const preview = computed<ChartElement>(() => ({ ...props.element, title: title.value, chart: chart.value, rows: rows.value }));

function addRow(): void {
  rows.value.push(Array<string>(columns.value).fill(''));
}

function addColumn(): void {
  rows.value = rows.value.map((row, index) => [...row, index === 0 ? t('Série {n}', { n: row.length }) : '']);
}

function removeRow(index: number): void {
  if (rows.value.length > 2) rows.value.splice(index, 1);
}

function removeColumn(index: number): void {
  if (columns.value > 2) rows.value = rows.value.map((row) => row.filter((_cell, position) => position !== index));
}

function save(): void {
  if (linked.value && props.source) {
    emit('save-source', rows.value);
    emit('save', { title: title.value, chart: chart.value });
  } else {
    emit('save', { title: title.value, chart: chart.value, rows: rows.value, source: null });
  }
  visible.value = false;
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="$t('Données du graphique')" :style="{ width: 'min(64rem, calc(100vw - 2rem))' }">
    <div class="layout">
      <div class="editor">
        <div class="settings">
          <label class="field grow">
            <span class="muted small">{{ $t('Titre') }}</span>
            <InputText v-model="title" size="small" :disabled="!editable" fluid />
          </label>
          <label class="field">
            <span class="muted small">{{ $t('Type') }}</span>
            <Select v-model="chart" :options="kinds" option-label="label" option-value="value" size="small" :disabled="!editable" />
          </label>
        </div>
        <p v-if="linked" class="linked small">
          <i class="pi pi-link"></i> {{ $t('Les données viennent d’un tableau du tableau blanc : les modifier ici le modifie aussi.') }}
          <Button v-if="editable" :label="$t('Délier')" size="small" text @click="linked = false" />
        </p>
        <p class="muted small">{{ $t('Première colonne : les étiquettes. Colonnes suivantes : une série chacune, avec son nom en en-tête.') }}</p>
        <div class="grid-wrap">
          <table class="grid">
            <tbody>
              <tr v-for="(row, rowIndex) in rows" :key="rowIndex">
                <td v-for="(_cell, columnIndex) in row" :key="columnIndex" :class="{ head: rowIndex === 0 || columnIndex === 0 }">
                  <input v-model="row[columnIndex]" :disabled="!editable" :aria-label="$t('Cellule')" />
                </td>
                <td class="tools">
                  <button v-if="editable && rowIndex > 0" type="button" :aria-label="$t('Supprimer la ligne')" @click="removeRow(rowIndex)"><i class="pi pi-times"></i></button>
                </td>
              </tr>
              <tr v-if="editable">
                <td v-for="columnIndex in columns" :key="columnIndex" class="tools">
                  <button v-if="columnIndex > 1" type="button" :aria-label="$t('Supprimer la colonne')" @click="removeColumn(columnIndex - 1)"><i class="pi pi-times"></i></button>
                </td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="editable" class="actions">
          <Button :label="$t('Ajouter une ligne')" icon="pi pi-plus" size="small" severity="secondary" text @click="addRow" />
          <Button :label="$t('Ajouter une série')" icon="pi pi-plus" size="small" severity="secondary" text @click="addColumn" />
        </div>
      </div>
      <section class="preview" :aria-label="$t('Aperçu du graphique')">
        <span class="muted small">{{ $t('Aperçu') }}</span>
        <div class="preview-chart">
          <BoardChart :element="preview" :rows="rows" />
        </div>
      </section>
    </div>
    <template #footer>
      <Button :label="editable ? $t('Annuler') : $t('Fermer')" severity="secondary" text @click="visible = false" />
      <Button v-if="editable" :label="$t('Enregistrer')" icon="pi pi-check" @click="save" />
    </template>
  </Dialog>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(16rem, 24rem);
  gap: 1.25rem;
  align-items: start;
}
/* Écran étroit : l'aperçu passe au-dessus de la grille. */
@media (max-width: 760px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .preview {
    order: -1;
  }
}
.editor {
  min-width: 0;
}
.preview {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.preview-chart {
  height: 17rem;
  --board-default-fill: var(--fb-panel);
}
.settings {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.grow {
  flex: 1;
}
.linked {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0 0 0.5rem;
  color: var(--fb-accent);
}
.grid-wrap {
  max-height: 20rem;
  overflow: auto;
}
.grid {
  border-collapse: collapse;
}
.grid td {
  padding: 0;
  border: 1px solid var(--fb-border);
}
.grid td.tools {
  border: 0;
  text-align: center;
}
.grid input {
  width: 7rem;
  padding: 0.35rem 0.5rem;
  border: 0;
  background: transparent;
  color: var(--fb-text);
  font: inherit;
  font-size: 0.85rem;
  outline: none;
}
.grid input:focus {
  box-shadow: inset 0 0 0 2px var(--fb-accent);
}
.grid td.head input {
  font-weight: 600;
}
.grid button {
  padding: 0.2rem;
  border: 0;
  background: none;
  color: var(--fb-muted);
  cursor: pointer;
}
.actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
</style>
