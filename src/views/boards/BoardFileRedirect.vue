<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Button from 'primevue/button';
import { api } from '@/api';

/** Lien direct vers un tableau (mention, lien copié) : on retrouve son espace, puis on l'ouvre. */
const route = useRoute();
const router = useRouter();
const failed = ref(false);

onMounted(async () => {
  try {
    const { space, node } = await api.board(Number(route.params.boardId));
    // Éléments cités (`?elements=a,b`) : le tableau s'ouvre sur eux.
    const elements = {
      ...(typeof route.query.elements === 'string' && route.query.elements ? { elements: route.query.elements } : {}),
      // Version citée : le tableau s'ouvre dans son historique, sur elle.
      ...(typeof route.query.version === 'string' && route.query.version ? { version: route.query.version } : {}),
    };
    await router.replace({ name: 'board-space', params: { spaceId: space.id }, query: { board: String(node.id), ...elements } });
  } catch {
    failed.value = true;
  }
});
</script>

<template>
  <div class="page state">
    <template v-if="failed">
      <i class="pi pi-lock icon"></i>
      <h2>{{ $t('Tableau introuvable') }}</h2>
      <p class="muted">{{ $t('Il a peut-être été supprimé, ou vous n’y avez pas accès.') }}</p>
      <Button :label="$t('Tous les tableaux blancs')" severity="secondary" outlined @click="router.push({ name: 'boards' })" />
    </template>
    <p v-else class="muted"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</p>
  </div>
</template>

<style scoped>
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 3rem 1rem;
  text-align: center;
}
.icon {
  color: #a855f7;
  font-size: 2rem;
}
h2 {
  margin: 0;
}
</style>
