<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import Button from 'primevue/button';
import type { DocHeading } from '@shared/docOutline';

/** Sommaire de la note : un clic amène au titre, et celui qu'on lit est mis en avant. */
const props = defineProps<{ headings: DocHeading[]; active: number }>();
const emit = defineEmits<{ go: [index: number]; close: [] }>();

const list = ref<HTMLElement | null>(null);
const top = computed(() => props.headings.reduce((smallest, heading) => Math.min(smallest, heading.level), 6));

// Un long sommaire suit la lecture.
watch(
  () => props.active,
  async (index) => {
    await nextTick();
    list.value?.children[index]?.scrollIntoView({ block: 'nearest' });
  },
);
</script>

<template>
  <nav class="doc-outline" :aria-label="$t('Sommaire')">
    <header class="head">
      <strong>{{ $t('Sommaire') }}</strong>
      <Button v-tooltip.bottom="$t('Masquer le sommaire')" icon="pi pi-angle-double-left" text rounded size="small" severity="secondary" :aria-label="$t('Masquer le sommaire')" @click="emit('close')" />
    </header>
    <ol v-if="headings.length" ref="list" class="list">
      <li v-for="(heading, index) in headings" :key="`${heading.line}-${heading.title}`">
        <button
          type="button"
          class="entry"
          :class="{ active: index === active, main: heading.level === top }"
          :style="{ paddingLeft: `${0.5 + (heading.level - top) * 0.8}rem` }"
          :aria-current="index === active ? 'location' : undefined"
          :title="heading.title"
          @click="emit('go', index)"
        >
          {{ heading.title }}
        </button>
      </li>
    </ol>
    <p v-else class="muted small empty">{{ $t('Les titres de la note apparaîtront ici.') }}</p>
  </nav>
</template>

<style scoped>
.doc-outline {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--fb-border);
  background: var(--fb-panel);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.25rem 0.25rem 0.25rem 0.75rem;
  font-size: 0.8rem;
}
.list {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0 0.4rem 1rem;
  overflow-y: auto;
  list-style: none;
}
.entry {
  display: block;
  width: 100%;
  padding: 0.22rem 0.5rem;
  overflow: hidden;
  border: 0;
  border-left: 2px solid transparent;
  border-radius: 0 6px 6px 0;
  background: none;
  color: var(--fb-muted);
  font: inherit;
  font-size: 0.82rem;
  line-height: 1.35;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.entry.main {
  color: var(--fb-text);
  font-weight: 600;
}
.entry:hover {
  background: var(--fb-panel-alt);
  color: var(--fb-text);
}
.entry.active {
  border-left-color: var(--fb-accent);
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
}
.empty {
  margin: 0;
  padding: 0.25rem 0.75rem;
}
</style>
