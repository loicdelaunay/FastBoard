import type { MenuItem } from 'primevue/menuitem';
import { t } from '@/i18n';
import { pinned, pinnedEntry, pinSpace, unpinSpace, syncSpace, type PinKind } from '@/offline/pinned';
import { notify } from '@/utils/notify';

const items = (n: number): string => t('{n} élément|{n} éléments', { n });

/** Entrées « Garder hors ligne » du clic droit d'un espace (documentation, tableaux blancs, projet). */
export function pinnedMenuItems(kind: PinKind, id: number, name: string): MenuItem[] {
  const entry = pinnedEntry(kind, id);
  if (!entry) {
    return [
      {
        label: t('Garder hors ligne'),
        icon: 'pi pi-cloud-download',
        command: async () => {
          notify('info', t('Gardé hors ligne'), t('La copie de « {name} » se fait maintenant, puis toutes les heures, sur cet appareil.', { name }));
          const done = await pinSpace(kind, id, name).then(() => !pinnedEntry(kind, id)?.failed);
          if (done) notify('success', t('Disponible hors ligne'), t('« {name} » est copié sur cet appareil ({count}).', { name, count: items(pinnedEntry(kind, id)?.items ?? 0) }));
        },
      },
    ];
  }
  return [
    {
      label: t('Actualiser la copie hors ligne'),
      icon: 'pi pi-refresh',
      disabled: pinned.syncing !== null,
      command: async () => {
        if (await syncSpace(entry)) notify('success', t('Copie hors ligne à jour'), t('« {name} » ({count}).', { name, count: items(entry.items) }));
        else notify('warn', t('Copie hors ligne non actualisée'), t('Le serveur ne répond pas ou l’espace n’est plus accessible ; elle sera retentée.'));
      },
    },
    {
      label: t('Ne plus garder hors ligne'),
      icon: 'pi pi-cloud',
      command: async () => {
        await unpinSpace(kind, id);
        notify('info', t('N’est plus gardé hors ligne'), t('La copie de « {name} » n’est plus actualisée et pourra être effacée.', { name }));
      },
    },
  ];
}
