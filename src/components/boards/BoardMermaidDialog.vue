<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import Textarea from 'primevue/textarea';
import MarkdownView from '@/components/common/MarkdownView.vue';
import { t } from '@/i18n';
import { downloadFile } from '@/utils/csv';
import { copyText } from '@/utils/docRender';
import { notify } from '@/utils/notify';

/** Export d'une sélection en Mermaid (à copier ou télécharger en .md), ou import d'un organigramme ou d'une carte mentale. */
const props = defineProps<{ mode: 'import' | 'export'; text: string; title: string }>();
const emit = defineEmits<{ import: [text: string] }>();
const visible = defineModel<boolean>('visible', { required: true });

const draft = ref('');
watch(
  () => [visible.value, props.text],
  () => {
    if (visible.value) draft.value = props.text;
  },
  { immediate: true },
);

/** Le texte sans sa clôture de code, quelle que soit la façon dont il a été collé. */
const code = computed(() => draft.value.replace(/^\s*```\s*mermaid\s*\n?/i, '').replace(/\n?```\s*$/, '').trim());
const fenced = computed(() => `\`\`\`mermaid\n${code.value}\n\`\`\``);
const preview = ref('');
let timer = 0;
watch(
  fenced,
  (value) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => (preview.value = code.value ? value : ''), 300);
  },
  { immediate: true },
);

async function copy(): Promise<void> {
  await copyText(fenced.value);
  notify('success', t('Mermaid copié'), t('Collez-le dans une note de la documentation pour afficher le diagramme.'));
}

function download(): void {
  const name = (props.title || t('Tableau blanc')).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'diagramme';
  downloadFile(`${name}.md`, `# ${props.title || t('Tableau blanc')}\n\n${fenced.value}\n`, 'text/markdown;charset=utf-8');
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="mode === 'export' ? $t('Exporter en Mermaid') : $t('Importer du Mermaid')" :style="{ width: 'min(60rem, calc(100vw - 2rem))' }">
    <p class="muted small intro">
      {{
        mode === 'export'
          ? $t('Le diagramme en Markdown Mermaid : il s’affiche tel quel dans une note de la documentation, sur GitHub ou dans Obsidian.')
          : $t('Collez un organigramme (flowchart, graph) ou une carte mentale (mindmap) Mermaid : il est posé sur le tableau, mis en page automatiquement.')
      }}
    </p>
    <div class="panes">
      <Textarea v-model="draft" class="code" rows="16" :readonly="mode === 'export'" :placeholder="'flowchart LR\n    A[Idée] --> B{Valide ?}\n    B -->|oui| C[Projet]'" spellcheck="false" :aria-label="$t('Code Mermaid')" />
      <div class="preview">
        <MarkdownView v-if="preview" :text="preview" />
        <p v-else class="muted small">{{ $t('L’aperçu du diagramme s’affiche ici.') }}</p>
      </div>
    </div>
    <template #footer>
      <template v-if="mode === 'export'">
        <Button :label="$t('Télécharger le .md')" icon="pi pi-download" severity="secondary" text @click="download" />
        <Button :label="$t('Copier')" icon="pi pi-copy" @click="copy" />
      </template>
      <template v-else>
        <Button :label="$t('Annuler')" severity="secondary" text @click="visible = false" />
        <Button :label="$t('Importer')" icon="pi pi-check" :disabled="!code" @click="emit('import', draft)" />
      </template>
    </template>
  </Dialog>
</template>

<style scoped>
.intro {
  margin: 0 0 0.75rem;
}
.panes {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.75rem;
  min-height: 20rem;
}
.code {
  width: 100%;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 0.82rem;
}
.preview {
  max-height: 26rem;
  overflow: auto;
  padding: 0.5rem;
  border: 1px solid var(--fb-border);
  border-radius: 8px;
  background: var(--fb-panel-alt);
}
@media (max-width: 760px) {
  .panes {
    grid-template-columns: 1fr;
  }
}
</style>
