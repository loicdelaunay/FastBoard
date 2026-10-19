<script setup lang="ts">
defineProps<{
  label: string;
  value: string;
  icon: string;
  hint?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'danger';
}>();
</script>

<template>
  <div class="tile card" :class="`tone-${tone ?? 'neutral'}`">
    <i class="icon" :class="icon" aria-hidden="true"></i>
    <div class="text">
      <span class="label muted small">{{ label }}</span>
      <strong class="value">{{ value }}</strong>
      <span v-if="hint" class="hint muted small">{{ hint }}</span>
    </div>
  </div>
</template>

<style scoped>
.tile {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.85rem 1rem;
  min-width: 0;
}
.icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 10px;
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
  font-size: 1.1rem;
}
.tone-good .icon {
  background: color-mix(in srgb, var(--fb-success, #22c55e) 16%, transparent);
  color: var(--fb-success, #22c55e);
}
.tone-warn .icon {
  background: color-mix(in srgb, #f59e0b 18%, transparent);
  color: #d97706;
}
.tone-danger .icon {
  background: color-mix(in srgb, var(--fb-danger) 16%, transparent);
  color: var(--fb-danger);
}
.text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.value {
  font-size: 1.3rem;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}
.hint {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
