import type { DocNodeDTO } from '@shared/docs';

/** Couleur habituelle des dossiers de la documentation (celle de l'arbre). */
export const DEFAULT_FOLDER_COLOR = '#f59e0b';

/** Icône d'un dossier : celle choisie, sinon le dossier habituel, ouvert ou fermé. */
export function folderIcon(node: Pick<DocNodeDTO, 'icon'>, open: boolean): string {
  return node.icon ?? (open ? 'pi pi-folder-open' : 'pi pi-folder');
}

/** Style de l'icône d'un dossier : sa couleur choisie, sinon celle de la feuille de style. */
export function folderIconStyle(node: Pick<DocNodeDTO, 'color'>): Record<string, string> | undefined {
  return node.color ? { color: node.color } : undefined;
}
