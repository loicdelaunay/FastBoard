<script setup lang="ts">
import Dialog from 'primevue/dialog';
import Tag from 'primevue/tag';
import { APP_VERSION, CHANGE_CATEGORIES, CHANGELOG } from '@shared/changelog';
import { formatDateShort } from '@shared/dates';

/** Journal des modifications de l'application, ouvert depuis la pastille de version. */
const visible = defineModel<boolean>('visible', { required: true });
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="$t('Nouveautés de FastBoard')" :style="{ width: 'min(40rem, 94vw)' }" :dismissable-mask="true">
    <p class="muted intro">{{ $t('Version installée : {version}', { version: APP_VERSION }) }}</p>
    <section v-for="release in CHANGELOG" :key="release.version" class="release">
      <header class="head">
        <h3 class="version">v{{ release.version }}</h3>
        <Tag v-if="release.version === APP_VERSION" :value="$t('Actuelle')" severity="success" />
        <span class="muted small">{{ formatDateShort(release.date, true) }}</span>
      </header>
      <ul class="changes">
        <li v-for="(change, index) in release.changes" :key="index" class="change">
          <Tag :value="$t(change.category)" :icon="CHANGE_CATEGORIES[change.category].icon" :severity="CHANGE_CATEGORIES[change.category].severity" class="category" />
          <span>{{ $t(change.text) }}</span>
        </li>
      </ul>
    </section>
  </Dialog>
</template>

<style scoped>
.intro {
  margin: 0 0 1rem;
}
.release + .release {
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--fb-border);
}
.head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 0.6rem;
}
.version {
  margin: 0;
  font-size: 1.05rem;
}
.changes {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.change {
  display: grid;
  grid-template-columns: 8.5rem minmax(0, 1fr);
  align-items: start;
  gap: 0.6rem;
  line-height: 1.45;
}
.category {
  justify-self: start;
  font-size: 0.7rem;
}
@media (max-width: 520px) {
  .change {
    grid-template-columns: minmax(0, 1fr);
    gap: 0.2rem;
  }
}
</style>
