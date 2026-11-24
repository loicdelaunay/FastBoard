<script setup lang="ts">
import { useAiStore } from '@/stores/ai';

/** Bouton de l'assistant IA (cerveau, halo dégradé animé façon Gemini) ; `label` : avec son nom, dans la barre latérale. */
defineProps<{ label?: string }>();
const ai = useAiStore();
</script>

<template>
  <button
    type="button"
    class="ai-button"
    :class="{ open: ai.open, busy: ai.busy, labelled: label }"
    :aria-label="$t('Assistant IA')"
    aria-keyshortcuts="Control+I"
    :aria-expanded="ai.open"
    v-tooltip.right="label ? $t('Ctrl I') : $t('Assistant IA (Ctrl I)')"
    @click="ai.toggle()"
  >
    <span class="orb">
    <span class="halo" aria-hidden="true"></span>
    <span class="core">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" class="brain">
        <defs>
          <linearGradient id="fb-ai-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#4f8cff" />
            <stop offset="50%" stop-color="#a95cff" />
            <stop offset="100%" stop-color="#ff6fa7" />
          </linearGradient>
        </defs>
        <path
          fill="none"
          stroke="url(#fb-ai-gradient)"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M9 3.5a2.6 2.6 0 0 0-2.6 2.2A2.8 2.8 0 0 0 4 8.5c0 .6.2 1.2.5 1.7A3 3 0 0 0 3.5 13a3 3 0 0 0 1.8 2.7A2.9 2.9 0 0 0 8.2 19a2.6 2.6 0 0 0 3.8 1V5a2.5 2.5 0 0 0-3-1.5ZM15 3.5a2.6 2.6 0 0 1 2.6 2.2A2.8 2.8 0 0 1 20 8.5c0 .6-.2 1.2-.5 1.7a3 3 0 0 1 1 2.8 3 3 0 0 1-1.8 2.7A2.9 2.9 0 0 1 15.8 19a2.6 2.6 0 0 1-3.8 1M8 9.5c1 .2 1.8.9 2 2M16 9.5c-1 .2-1.8.9-2 2M8.5 15c.9-.6 2-.6 2.8 0M15.5 15c-.9-.6-2-.6-2.8 0"
        />
      </svg>
      <i class="spark s1" aria-hidden="true"></i>
      <i class="spark s2" aria-hidden="true"></i>
    </span>
    </span>
    <span v-if="label" class="ai-label">{{ label }}</span>
  </button>
</template>

<style scoped>
.ai-button {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--fb-text);
  font: inherit;
  cursor: pointer;
}
.orb {
  position: relative;
  display: grid;
  place-items: center;
  width: 2.3rem;
  height: 2.3rem;
  flex: none;
  border-radius: 999px;
  isolation: isolate;
}
/* Dans la barre latérale : une ligne comme les autres, avec un halo plus petit. */
.ai-button.labelled {
  width: 100%;
  padding: 0.2rem 0.5rem 0.2rem 0.35rem;
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: 600;
}
.ai-button.labelled .orb {
  width: 1.75rem;
  height: 1.75rem;
}
.ai-button.labelled:hover,
.ai-button.labelled:focus-visible {
  background: var(--fb-panel-alt);
}
.ai-label {
  background: linear-gradient(90deg, #4f8cff, #a95cff, #ff6fa7);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
/* Anneau dégradé qui tourne lentement, plus vif au survol, pendant une réponse ou panneau ouvert. */
.halo {
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  background: conic-gradient(from 0deg, #4f8cff, #a95cff, #ff6fa7, #ffb86b, #4f8cff);
  opacity: 0.55;
  filter: blur(0.5px);
  animation: fb-ai-spin 6s linear infinite;
}
.halo::after {
  content: '';
  position: absolute;
  inset: 2px;
  border-radius: inherit;
  background: var(--fb-panel);
}
.ai-button:hover .halo,
.ai-button:focus-visible .halo,
.ai-button.open .halo {
  opacity: 1;
  animation-duration: 3s;
  box-shadow: 0 0 14px rgb(169 92 255 / 45%);
}
.ai-button.busy .halo {
  opacity: 1;
  animation-duration: 1.1s;
  box-shadow: 0 0 18px rgb(79 140 255 / 55%);
}
.ai-button:focus-visible {
  outline: none;
}
.core {
  position: relative;
  display: grid;
  place-items: center;
}
.brain {
  transition: transform 0.25s ease;
}
.ai-button:hover .brain,
.ai-button.open .brain {
  transform: scale(1.08);
}
.ai-button.busy .brain {
  animation: fb-ai-pulse 1.2s ease-in-out infinite;
}
.spark {
  position: absolute;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 6px #a95cff;
  opacity: 0;
}
.s1 {
  top: -5px;
  right: -6px;
}
.s2 {
  bottom: -4px;
  left: -6px;
  background: #ffd36b;
}
.ai-button:hover .spark,
.ai-button.busy .spark,
.ai-button.open .spark {
  animation: fb-ai-twinkle 1.6s ease-in-out infinite;
}
.ai-button .s2 {
  animation-delay: 0.6s !important;
}
@keyframes fb-ai-spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes fb-ai-pulse {
  50% {
    transform: scale(1.15);
  }
}
@keyframes fb-ai-twinkle {
  0%,
  100% {
    opacity: 0;
    transform: scale(0.4);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}
@media (prefers-reduced-motion: reduce) {
  .halo,
  .brain,
  .spark {
    animation: none !important;
  }
}
</style>
