<script setup lang="ts">
import { computed } from 'vue';
import { THEMES, type ThemeDef } from '@shared/themes';
import { currentThemeId } from '@/theme/themeManager';

import { t } from '@/i18n';
defineProps<{ disabled?: boolean }>();
const emit = defineEmits<{ select: [themeId: string] }>();

const groups = computed(() => [
  { key: 'light', title: t('Thèmes clairs'), icon: 'pi pi-sun', themes: THEMES.filter((theme) => theme.mode === 'light') },
  { key: 'dark', title: t('Thèmes sombres'), icon: 'pi pi-moon', themes: THEMES.filter((theme) => theme.mode === 'dark') },
]);

function swatchStyle(theme: ThemeDef): Record<string, string> {
  return { '--sw-bg': theme.preview.background, '--sw-fg': theme.preview.text, '--sw-accent': theme.preview.accent };
}
</script>

<template>
  <div class="theme-picker">
    <section v-for="group in groups" :key="group.key">
      <h4 class="group-title"><i :class="group.icon"></i> {{ group.title }}</h4>
      <div class="grid" role="radiogroup" :aria-label="group.title">
        <button
          v-for="theme in group.themes"
          :key="theme.id"
          type="button"
          role="radio"
          class="theme-card"
          :class="{ selected: currentThemeId === theme.id }"
          :aria-checked="currentThemeId === theme.id"
          :disabled="disabled"
          @click="emit('select', theme.id)"
        >
          <span class="swatch" :style="swatchStyle(theme)">
            <span class="bar"></span>
            <span class="lines"><i></i><i></i></span>
            <span class="chip"></span>
          </span>
          <span class="name">{{ $t(theme.label) }}</span>
          <i v-if="currentThemeId === theme.id" class="pi pi-check-circle check"></i>
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.theme-picker {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
.group-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.6rem;
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--fb-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
  gap: 0.6rem;
}
.theme-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.45rem;
  border: 2px solid var(--fb-border);
  border-radius: 12px;
  background: var(--fb-panel);
  color: var(--fb-text);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, transform 0.15s;
}
.theme-card:hover:not(:disabled) {
  border-color: var(--fb-accent);
  transform: translateY(-1px);
}
.theme-card:focus-visible {
  outline: 2px solid var(--fb-accent);
  outline-offset: 2px;
}
.theme-card.selected {
  border-color: var(--fb-accent);
  box-shadow: 0 0 0 3px var(--fb-accent-soft);
}
.swatch {
  position: relative;
  display: block;
  height: 3.6rem;
  padding: 0.45rem;
  border-radius: 8px;
  background: var(--sw-bg);
  border: 1px solid color-mix(in srgb, var(--sw-fg) 14%, transparent);
  overflow: hidden;
}
.bar {
  display: block;
  width: 55%;
  height: 0.4rem;
  border-radius: 4px;
  background: var(--sw-accent);
}
.lines {
  display: block;
  margin-top: 0.4rem;
}
.lines i {
  display: block;
  height: 0.25rem;
  margin-bottom: 0.25rem;
  border-radius: 3px;
  background: color-mix(in srgb, var(--sw-fg) 35%, transparent);
}
.lines i:last-child {
  width: 70%;
}
.chip {
  position: absolute;
  right: 0.45rem;
  bottom: 0.45rem;
  width: 1.1rem;
  height: 0.7rem;
  border-radius: 4px;
  background: var(--sw-accent);
}
.name {
  padding: 0 0.15rem 0.1rem;
  font-size: 0.8rem;
  font-weight: 600;
}
.check {
  position: absolute;
  top: 0.8rem;
  right: 0.85rem;
  color: var(--sw-accent);
  font-size: 1rem;
  background: var(--sw-bg);
  border-radius: 50%;
}
</style>
