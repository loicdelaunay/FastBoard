import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { MeDTO } from '@shared/types';
import { api } from '@/api';
import { setCurrentUserId } from '@/api/http';
import { realtime } from '@/realtime/socket';
import type { Locale } from '@shared/locales';
import { currentLocale, rememberLocale } from '@/i18n';
import { applyTheme } from '@/theme/themeManager';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<MeDTO | null>(null);
  const ready = ref(false);
  const isAuthenticated = computed(() => user.value !== null);

  function can(permission: string): boolean {
    const granted = user.value?.permissions ?? [];
    return granted.includes('*') || granted.includes(permission);
  }

  const canAdmin = computed(
    () => can('admin.access') && ['users.view', 'users.create', 'users.edit', 'roles.manage', 'tokens.manage', 'monitoring.view', 'logs.view'].some((permission) => can(permission)),
  );

  function setUser(next: MeDTO | null): void {
    user.value = next;
    setCurrentUserId(next?.id ?? null);
    if (next) {
      applyTheme(next.theme);
      // La langue du compte l'emporte : on la mémorise et on recharge, les textes étant lus au chargement.
      if (next.locale && next.locale !== currentLocale()) {
        rememberLocale(next.locale);
        window.location.reload();
      }
    }
  }

  async function init(): Promise<void> {
    try {
      setUser((await api.me()).user);
      realtime.connect();
    } catch {
      setUser(null);
    } finally {
      ready.value = true;
    }
  }

  async function login(email: string, password: string): Promise<void> {
    setUser((await api.login(email, password)).user);
    realtime.connect();
    announceAccountChange();
  }

  async function logout(): Promise<void> {
    try {
      await api.logout();
    } finally {
      expire();
    }
  }

  /** Efface la session locale (déconnexion volontaire ou session expirée). */
  function expire(): void {
    realtime.disconnect();
    setUser(null);
    announceAccountChange();
  }

  async function refresh(): Promise<void> {
    try {
      setUser((await api.me()).user);
    } catch {
      /* la gestion d'une session expirée est faite par le handler 401 global */
    }
  }

  async function updateProfile(patch: { name?: string; theme?: string; locale?: Locale }): Promise<void> {
    if (patch.theme) {
      applyTheme(patch.theme);
    }
    const { user: fresh } = await api.updateMe(patch);
    user.value = fresh;
  }

  async function uploadAvatar(blob: Blob): Promise<void> {
    user.value = (await api.uploadAvatar(blob)).user;
  }

  async function removeAvatar(): Promise<void> {
    user.value = (await api.removeAvatar()).user;
  }

  realtime.on('meRefresh', () => void refresh());

  // Le cookie de session est partagé par tous les onglets : si l'on se (dé)connecte ou change de compte dans l'un d'eux,
  // les autres rechargent pour refléter le compte réellement actif (sinon ils agiraient avec le mauvais compte).
  const SYNC_KEY = 'fb.account-sync';

  function announceAccountChange(): void {
    try {
      localStorage.setItem(SYNC_KEY, `${Date.now()}:${user.value?.id ?? 'none'}`);
    } catch {
      /* stockage indisponible : la détection côté serveur (401 session_changed) prend le relais */
    }
  }

  window.addEventListener('storage', (event) => {
    if (event.key !== SYNC_KEY || !event.newValue) {
      return;
    }
    const announced = event.newValue.split(':')[1];
    if (announced !== String(user.value?.id ?? 'none')) {
      window.location.reload();
    }
  });

  return { user, ready, isAuthenticated, canAdmin, can, init, login, logout, expire, refresh, updateProfile, uploadAvatar, removeAvatar };
});
