import ToastEventBus from 'primevue/toasteventbus';

import { t } from '@/i18n';
type Severity = 'success' | 'info' | 'warn' | 'error';

/** Affiche une notification depuis n'importe où (stores compris), sans passer par `useToast()`. */
export function notify(severity: Severity, summary: string, detail?: string, life = 4000): void {
  ToastEventBus.emit('add', { severity, summary, detail, life });
}

export const notifyError = (error: unknown, summary = t('Action impossible')): void =>
  notify('error', summary, error instanceof Error ? error.message : String(error), 6000);
