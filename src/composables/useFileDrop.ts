import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
import { notify } from '@/utils/notify';

import { t } from '@/i18n';
function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/** Fichiers déposés, sans les dossiers (qui ne peuvent pas être envoyés tels quels). */
function droppedFiles(event: DragEvent): File[] {
  const transfer = event.dataTransfer;
  if (!transfer) {
    return [];
  }
  let skippedFolders = 0;
  const files: File[] = [];
  const items = Array.from(transfer.items ?? []);
  if (items.length > 0) {
    for (const item of items) {
      if (item.kind !== 'file') continue;
      if (item.webkitGetAsEntry?.()?.isDirectory) {
        skippedFolders += 1;
        continue;
      }
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  } else {
    files.push(...Array.from(transfer.files));
  }
  if (skippedFolders > 0) {
    notify('warn', t('Dossier ignoré'), t('Seuls les fichiers peuvent être joints : compressez le dossier (.zip) pour l’envoyer.'));
  }
  return files;
}

/**
 * Zone de dépôt de fichiers : `dragging` est vrai tant qu'un fichier survole `target`.
 * Les glisser-déposer internes (cartes, textes) sont ignorés : seuls les fichiers du système comptent.
 */
export function useFileDrop(target: Ref<HTMLElement | null>, onFiles: (files: File[]) => void, enabled: () => boolean) {
  const dragging = ref(false);
  let depth = 0;

  function onEnter(event: DragEvent): void {
    if (!enabled() || !hasFiles(event)) return;
    event.preventDefault();
    depth += 1;
    dragging.value = true;
  }
  function onOver(event: DragEvent): void {
    if (!enabled() || !hasFiles(event)) return;
    // Sans preventDefault, le navigateur ouvrirait le fichier au lieu de nous le confier.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }
  function onLeave(event: DragEvent): void {
    if (!hasFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) dragging.value = false;
  }
  function onDrop(event: DragEvent): void {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth = 0;
    dragging.value = false;
    if (!enabled()) return;
    const files = droppedFiles(event);
    if (files.length > 0) onFiles(files);
  }

  /** Un fichier lâché hors de la zone ne doit pas faire quitter la page : le navigateur l'ouvrirait. */
  function swallow(event: DragEvent): void {
    if (hasFiles(event)) event.preventDefault();
  }

  onMounted(() => {
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    const element = target.value;
    element?.addEventListener('dragenter', onEnter);
    element?.addEventListener('dragover', onOver);
    element?.addEventListener('dragleave', onLeave);
    element?.addEventListener('drop', onDrop);
  });
  onBeforeUnmount(() => {
    window.removeEventListener('dragover', swallow);
    window.removeEventListener('drop', swallow);
    const element = target.value;
    element?.removeEventListener('dragenter', onEnter);
    element?.removeEventListener('dragover', onOver);
    element?.removeEventListener('dragleave', onLeave);
    element?.removeEventListener('drop', onDrop);
  });

  return { dragging };
}
