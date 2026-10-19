<script setup lang="ts">
import { computed } from 'vue';
import { diffDays, formatDateShort } from '@shared/dates';
import ProgressMeter from '@/components/common/ProgressMeter.vue';

import { t } from '@/i18n';
const props = defineProps<{
  title: string;
  period: { start: string; end: string } | null;
  today: string;
  progress: number;
  theoretical: number | null;
  gap: number | null;
  daysLeft: number | null;
}>();

const tone = computed(() => {
  if (props.gap === null) return 'neutral';
  if (props.gap >= 0) return 'good';
  return props.gap > -10 ? 'warn' : 'bad';
});

const gapLabel = computed(() => {
  if (props.gap === null) return '';
  if (props.gap === 0) return t('Dans les temps');
  return props.gap > 0 ? t("{gap} pts d'avance", { gap: props.gap }) : t('{gap} pts de retard', { gap: -props.gap });
});

const todayPercent = computed(() => {
  if (!props.period) return 0;
  const total = diffDays(props.period.start, props.period.end) + 1;
  return Math.min(100, Math.max(0, ((diffDays(props.period.start, props.today) + 0.5) / total) * 100));
});

const timeLabel = computed(() => {
  if (props.daysLeft === null) return '';
  if (props.daysLeft > 0) return t('{n} jour restant|{n} jours restants', { n: props.daysLeft });
  if (props.daysLeft === 0) return t("Échéance aujourd'hui");
  return t('Échéance dépassée de {n} jour|Échéance dépassée de {n} jours', { n: -props.daysLeft });
});
</script>

<template>
  <section class="schedule card">
    <header class="head">
      <h3 class="title">{{ title }}</h3>
      <span v-if="gapLabel" class="gap" :class="`tone-${tone}`">{{ gapLabel }}</span>
    </header>

    <template v-if="period">
      <div class="timeline" role="img" :aria-label="$t('Du {value} au {value2}', { value: formatDateShort(period.start, true), value2: formatDateShort(period.end, true) })">
        <div class="track">
          <span class="elapsed" :style="{ width: `${todayPercent}%` }"></span>
          <span class="today" :style="{ left: `${todayPercent}%` }"><em>{{ $t('Aujourd\'hui') }}</em></span>
        </div>
        <div class="bounds">
          <span><strong>{{ formatDateShort(period.start, true) }}</strong> {{ $t('début') }}</span>
          <span class="muted">{{ timeLabel }}</span>
          <span>{{ $t('fin') }} <strong>{{ formatDateShort(period.end, true) }}</strong></span>
        </div>
      </div>

      <div class="compare">
        <div>
          <p class="label muted small">{{ $t('Avancement réel') }}</p>
          <ProgressMeter :value="progress" :height="10" :marker="theoretical" />
        </div>
        <div>
          <p class="label muted small">{{ $t('Avancement théorique (temps écoulé)') }}</p>
          <ProgressMeter :value="theoretical ?? 0" :height="10" />
        </div>
      </div>
    </template>
    <p v-else class="muted small">{{ $t('Aucune livraison datée : créez des livraisons dans les réglages du projet pour comparer le réel au théorique.') }}</p>
  </section>
</template>

<style scoped>
.schedule {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem 1.1rem;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.title {
  font-size: 0.95rem;
  font-weight: 700;
}
.gap {
  padding: 0.15rem 0.65rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 700;
}
.tone-good {
  background: color-mix(in srgb, #22c55e 16%, transparent);
  color: #15803d;
}
.tone-warn {
  background: color-mix(in srgb, #f59e0b 18%, transparent);
  color: #b45309;
}
.tone-bad {
  background: color-mix(in srgb, #ef4444 16%, transparent);
  color: #dc2626;
}
:root.app-dark .tone-good {
  color: #4ade80;
}
:root.app-dark .tone-warn {
  color: #fbbf24;
}
:root.app-dark .tone-bad {
  color: #f87171;
}
.track {
  position: relative;
  height: 10px;
  margin: 1.4rem 0 0.5rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--fb-muted) 22%, transparent);
}
.elapsed {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--fb-accent) 45%, transparent);
}
.today {
  position: absolute;
  top: -4px;
  bottom: -4px;
  width: 3px;
  margin-left: -1.5px;
  border-radius: 2px;
  background: var(--fb-accent);
}
.today em {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.7rem;
  font-style: normal;
  font-weight: 700;
  white-space: nowrap;
  color: var(--fb-accent);
}
.bounds {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.78rem;
}
.compare {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: 1rem 1.5rem;
}
.label {
  margin: 0 0 0.3rem;
}
</style>
