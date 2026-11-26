<script setup lang="ts">
import { computed, onMounted } from 'vue';
import type { FavoriteKind } from '@shared/home';
import { t } from '@/i18n';
import { connection } from '@/offline/connection';
import { useFavoritesStore } from '@/stores/favorites';
import { notifyError } from '@/utils/notify';

/** Étoile d'une carte d'espace ou de projet : le met en favori (Accueil, en tête des listes) ou l'en retire. */
const props = defineProps<{ kind: FavoriteKind; id: number }>();
const store = useFavoritesStore();
onMounted(() => void store.ensure());

const on = computed(() => store.isFavorite(props.kind, props.id));
const label = computed(() => (on.value ? t('Retirer des favoris') : t('Ajouter aux favoris')));

async function toggle(): Promise<void> {
  try {
    await store.toggle(props.kind, props.id);
  } catch (error) {
    notifyError(error);
  }
}
</script>

<template>
  <span
    v-tooltip.top="label"
    class="favorite-star"
    :class="{ on, hidden: !on && connection.offline }"
    role="button"
    tabindex="0"
    :aria-label="label"
    :aria-pressed="on"
    @click.stop.prevent="!connection.offline && toggle()"
    @keydown.enter.stop.prevent="!connection.offline && toggle()"
  >
    <i :class="on ? 'pi pi-star-fill' : 'pi pi-star'"></i>
  </span>
</template>

<style scoped>
.favorite-star {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 1.6rem;
  height: 1.6rem;
  border-radius: 999px;
  color: var(--fb-muted);
  font-size: 0.85rem;
  cursor: pointer;
  opacity: 0.55;
  transition: opacity 0.12s, background 0.12s;
}
.favorite-star:hover,
.favorite-star:focus-visible {
  opacity: 1;
  background: color-mix(in srgb, #f59e0b 14%, transparent);
  color: #d97706;
}
.favorite-star.on {
  opacity: 1;
  color: #f59e0b;
}
.favorite-star.hidden {
  display: none;
}
</style>
