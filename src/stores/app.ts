import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { AppInfoDTO } from '@shared/types';
import { http } from '@/api/http';
import { realtime } from '@/realtime/socket';

/** Nom, logo et message de maintenance de l'application (publics, rafraîchis en direct). */
export const useAppStore = defineStore('app', () => {
  const info = ref<AppInfoDTO>({ name: 'FastBoard', logoVersion: 0, version: '', maintenance: null, ai: false });

  const name = computed(() => info.value.name);
  const logoUrl = computed(() => (info.value.logoVersion ? `/api/app/logo?v=${info.value.logoVersion}` : '/favicon.svg'));

  /** Applique le nom à l'onglet du navigateur et le logo à l'icône de l'onglet. */
  function applyToDocument(): void {
    document.title = info.value.name;
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) {
      icon.href = logoUrl.value;
      icon.type = info.value.logoVersion ? 'image/png' : 'image/svg+xml';
    }
  }

  function set(next: AppInfoDTO): void {
    info.value = next;
    applyToDocument();
  }

  async function load(): Promise<void> {
    try {
      set(await http<AppInfoDTO>('GET', '/app', { silent401: true }));
    } catch {
      // Valeurs par défaut : l'application reste utilisable.
    }
  }

  realtime.on('app', set);
  // Après une coupure, un changement a pu être manqué.
  realtime.on('resync', () => void load());

  return { info, name, logoUrl, load, set };
});
