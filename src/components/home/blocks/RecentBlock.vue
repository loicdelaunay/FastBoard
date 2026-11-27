<script setup lang="ts">
import { computed } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import type { HomeRecentDTO } from '@shared/home';
import type { HomeBlock } from '@shared/homeLayout';
import { formatDateTime, formatRelative } from '@/utils/format';
import HomeBlockFrame from '../HomeBlockFrame.vue';
import { useHomeSources } from '../homeContext';

/** Notes, tableaux et tickets que j'ai modifiés en dernier. */
const props = defineProps<{ block: HomeBlock }>();
const { home } = useHomeSources();
const shown = computed(() => (home.value?.recent ?? []).slice(0, props.block.options.limit ?? 12));

const ICONS: Record<HomeRecentDTO['kind'], string> = { note: 'pi pi-file', board: 'pi pi-objects-column', ticket: 'pi pi-ticket' };
const recentRoute = (item: HomeRecentDTO): RouteLocationRaw =>
  item.kind === 'note' ? { name: 'doc-file', params: { nodeId: item.id } } : item.kind === 'board' ? { name: 'board-file', params: { boardId: item.id } } : { name: 'project', params: { projectId: item.spaceId }, query: { ticket: String(item.id) } };
</script>

<template>
  <HomeBlockFrame :block="block">
    <ul v-if="shown.length" class="rows">
      <li v-for="item in shown" :key="`${item.kind}:${item.id}`">
        <router-link :to="recentRoute(item)" class="row" draggable="false">
          <i :class="ICONS[item.kind]" class="row-icon" :data-kind="item.kind"></i>
          <span class="row-text">
            <span class="truncate"><span v-if="item.key" class="key">{{ item.key }}</span> {{ item.title }}</span>
            <span class="muted small truncate">{{ item.spaceName }}</span>
          </span>
          <time class="muted small" :datetime="item.at" :title="formatDateTime(item.at)">{{ formatRelative(item.at) }}</time>
        </router-link>
      </li>
    </ul>
    <p v-else class="hint muted small">{{ $t('Les notes, tableaux et tickets que vous modifiez apparaîtront ici.') }}</p>
  </HomeBlockFrame>
</template>

<style scoped src="../home.css"></style>
