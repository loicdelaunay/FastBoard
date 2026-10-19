import { ref } from 'vue';
import type { AnalysisScope } from '@/composables/useAnalysis';
import { t } from '@/i18n';
import { notify, notifyError } from '@/utils/notify';

/** Export PDF de l'analyseur (le générateur est chargé à la demande : il pèse plusieurs centaines de Ko). */
export function usePdfExport() {
  const busy = ref<AnalysisScope | null>(null);

  async function exportScope(scope: AnalysisScope): Promise<void> {
    if (busy.value !== null) {
      return;
    }
    busy.value = scope;
    try {
      const { exportAnalysisPdf } = await import('@/utils/analysisPdf');
      await exportAnalysisPdf(scope);
      notify('success', t('PDF généré'), t('Le rapport a été téléchargé.'));
    } catch (error) {
      notifyError(error, t('Export PDF impossible'));
    } finally {
      busy.value = null;
    }
  }

  return { busy, exportScope };
}
