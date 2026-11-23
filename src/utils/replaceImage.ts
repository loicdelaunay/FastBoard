import type { DocNodeDTO } from '@shared/docs';
import { api } from '@/api';
import { t } from '@/i18n';
import { useDocsStore } from '@/stores/docs';
import { pickImage } from './image';
import { notify, notifyError } from './notify';

/**
 * « Remplacer l'image », proposé au clic droit sur les images : dans la documentation (arbre, note en lecture ou en
 * écriture), sur les tableaux blancs et dans les pièces jointes des tickets.
 */

/** Adresse d'une image de la documentation ; elle change quand l'image est remplacée, le navigateur ne garde pas l'ancienne. */
export function docImageUrl(node: Pick<DocNodeDTO, 'id' | 'updatedAt'>): string {
  return `/api/documentation/nodes/${node.id}/raw?v=${encodeURIComponent(node.updatedAt)}`;
}

/** Image de la documentation montrée à cette adresse, ou `null` (image d'un autre site, d'un tableau…). */
export function docImageIdOf(src: string): number | null {
  const match = /\/api\/documentation\/nodes\/(\d+)\/raw(?:[?#]|$)/.exec(src);
  return match ? Number(match[1]) : null;
}

/**
 * Remplace une image de la documentation, sur place : elle garde son nom, et toutes les notes qui la montrent affichent
 * la nouvelle. L'ancienne reste 15 jours dans la corbeille. Vrai si l'image a été remplacée.
 */
export async function replaceDocImage(node: DocNodeDTO): Promise<boolean> {
  const file = await pickImage();
  if (!file) return false;
  try {
    const { node: updated } = await api.docReplaceImage(node.id, node.path, file);
    // L'arbre arrive aussi par le temps réel ; on n'attend pas pour montrer la nouvelle image.
    const store = useDocsStore();
    const index = store.nodes.findIndex((entry) => entry.id === updated.id);
    if (index >= 0) store.nodes.splice(index, 1, updated);
    notify('success', t('Image remplacée'), t('Elle change partout où elle est montrée ; l’ancienne reste 15 jours dans la corbeille.'));
    return true;
  } catch (error) {
    notifyError(error, t('Image non remplacée'));
    return false;
  }
}
