<script setup lang="ts">
import { computed } from 'vue';
import { DOC_ROLE_LABELS, type DocRole } from '@shared/docs';
import { t } from '@/i18n';

/**
 * Rôle dans un espace (documentation ou tableaux blancs), en icône seule : le texte s'affiche au survol, et le nom de
 * l'espace garde toute la place. `adminAccess` : on y entre par ses droits d'administration, sans en être propriétaire.
 */
const props = withDefaults(defineProps<{ role: DocRole; adminAccess?: boolean; tooltip?: 'top' | 'bottom' }>(), { adminAccess: false, tooltip: 'top' });

const ICONS: Record<DocRole, string> = { owner: 'pi pi-crown', editor: 'pi pi-pencil', reader: 'pi pi-eye' };
const icon = computed(() => (props.adminAccess ? 'pi pi-shield' : ICONS[props.role]));
const label = computed(() =>
  props.adminAccess ? t('Accès avec droit admin : vous n’êtes pas propriétaire de cet espace, vous y entrez grâce à vos droits d’administration.') : t(DOC_ROLE_LABELS[props.role]),
);
const tip = computed(() => ({ value: label.value, showDelay: 150 }));
</script>

<template>
  <span v-if="tooltip === 'bottom'" v-tooltip.bottom="tip" class="space-role" :class="{ admin: adminAccess }" role="img" :aria-label="label" tabindex="0">
    <i :class="icon"></i>
  </span>
  <span v-else v-tooltip.top="tip" class="space-role" :class="{ admin: adminAccess }" role="img" :aria-label="label" tabindex="0">
    <i :class="icon"></i>
  </span>
</template>

<style scoped>
.space-role {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 1.6rem;
  height: 1.6rem;
  border-radius: 999px;
  background: var(--fb-panel-alt);
  color: var(--fb-muted);
  font-size: 0.8rem;
  cursor: help;
}
.space-role.admin {
  background: color-mix(in srgb, #f59e0b 18%, transparent);
  color: #b45309;
}
:global(.app-dark) .space-role.admin {
  color: #fbbf24;
}
.space-role:focus-visible {
  outline: 2px solid var(--fb-accent);
  outline-offset: 1px;
}
</style>
