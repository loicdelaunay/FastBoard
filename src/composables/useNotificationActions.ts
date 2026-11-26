import { computed } from 'vue';
import { useRouter } from 'vue-router';
import type { MenuItem } from 'primevue/menuitem';
import { useConfirm } from 'primevue/useconfirm';
import type { NotificationDTO } from '@shared/types';
import { t } from '@/i18n';
import { connection } from '@/offline/connection';
import { useNotificationsStore } from '@/stores/notifications';
import { useUiStore } from '@/stores/ui';
import { notificationCategoryOptions, notificationRoute } from '@/utils/notificationText';
import { notify, notifyError } from '@/utils/notify';

/** Ce que font la fenêtre de la cloche et la page « Notifications » : ouvrir, lire, effacer, régler. */
export function useNotificationActions(options: { beforeNavigate?: () => void } = {}) {
  const store = useNotificationsStore();
  const ui = useUiStore();
  const router = useRouter();
  const confirm = useConfirm();

  /** Nom de la catégorie montrée, pour les messages (« les mentions »). */
  const scope = computed(() => notificationCategoryOptions().find((option) => option.value === store.category)?.label ?? t('Toutes'));

  async function open(item: NotificationDTO): Promise<void> {
    options.beforeNavigate?.();
    if (!item.readAt && !connection.offline) void store.markRead([item.id]).catch(() => undefined);
    const route = notificationRoute(item);
    if (route) await router.push(route);
  }

  async function remove(item: NotificationDTO): Promise<void> {
    try {
      await store.remove(item.id);
    } catch (error) {
      notifyError(error);
    }
  }

  async function readAll(): Promise<void> {
    try {
      await store.markRead();
    } catch (error) {
      notifyError(error);
    }
  }

  async function clearRead(): Promise<void> {
    try {
      const removed = await store.clear(true);
      notify('success', t('Notifications effacées'), t('{n} notification lue effacée.|{n} notifications lues effacées.', { n: removed }));
    } catch (error) {
      notifyError(error);
    }
  }

  function clearAll(): void {
    options.beforeNavigate?.();
    confirm.require({
      header: store.category ? t('Effacer les notifications « {scope} » ?', { scope: scope.value }) : t('Effacer toutes les notifications ?'),
      message: t('Lues ou non, elles disparaissent de la liste, sur tous vos appareils. Cela ne change rien aux tickets ni aux documents.'),
      icon: 'pi pi-trash',
      acceptLabel: t('Tout effacer'),
      rejectLabel: t('Annuler'),
      acceptProps: { severity: 'danger' },
      rejectProps: { severity: 'secondary', text: true },
      accept: async () => {
        try {
          const removed = await store.clear(false);
          notify('success', t('Notifications effacées'), t('{n} notification effacée.|{n} notifications effacées.', { n: removed }));
        } catch (error) {
          notifyError(error);
        }
      },
    });
  }

  function openSettings(): void {
    options.beforeNavigate?.();
    ui.openProfile('notifications');
  }

  /** Menu « ⋯ » : lire, effacer (dans la catégorie montrée), régler. */
  const menu = computed<MenuItem[]>(() => {
    const total = store.category ? store.counts[store.category].total : Object.values(store.counts).reduce((sum, entry) => sum + entry.total, 0);
    const unread = store.category ? store.counts[store.category].unread : store.unread;
    const offline = connection.offline;
    return [
      { label: t('Tout marquer comme lu'), icon: 'pi pi-check', disabled: offline || !unread, command: () => void readAll() },
      { label: t('Effacer les notifications lues'), icon: 'pi pi-eraser', disabled: offline || total === unread, command: () => void clearRead() },
      { label: store.category ? t('Effacer ces notifications') : t('Tout effacer'), icon: 'pi pi-trash', class: 'menu-danger', disabled: offline || !total, command: clearAll },
      { separator: true },
      { label: t('Réglages des notifications'), icon: 'pi pi-cog', command: openSettings },
    ];
  });

  return { open, remove, readAll, clearRead, clearAll, openSettings, menu };
}
