<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/api';

/** Lien vers un fichier (mention, notification) : retrouve son espace, puis ouvre le fichier. */
const route = useRoute();
const router = useRouter();
const failed = ref(false);

onMounted(async () => {
  try {
    const { node } = await api.docNode(Number(route.params.nodeId));
    // Lignes citées (`?lines=12-18`) : la note s'ouvre sur elles, surlignées.
    const lines = {
      ...(typeof route.query.lines === 'string' && route.query.lines ? { lines: route.query.lines } : {}),
      // Version étiquetée citée : la note s'ouvre sur elle, en lecture seule.
      ...(typeof route.query.version === 'string' && route.query.version ? { version: route.query.version } : {}),
    };
    // L'ancre (`#etape-2`, l'endroit lu) suit : le lien mène au même endroit de la note.
    await router.replace({ name: 'doc-space', params: { spaceId: node.spaceId }, query: { file: String(node.id), ...lines }, hash: route.hash });
  } catch {
    failed.value = true;
  }
});
</script>

<template>
  <div class="page">
    <div class="empty card">
      <template v-if="failed">
        <i class="pi pi-lock icon"></i>
        <h3>{{ $t('Fichier inaccessible') }}</h3>
        <p class="muted">{{ $t('Il a peut-être été supprimé, ou vous n’avez pas accès à son espace.') }}</p>
      </template>
      <p v-else class="muted"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</p>
    </div>
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 3rem 1rem;
  text-align: center;
}
.icon {
  color: var(--fb-muted);
  font-size: 2rem;
}
</style>
