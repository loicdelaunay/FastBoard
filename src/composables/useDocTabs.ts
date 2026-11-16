import { computed, ref, watch, type Ref } from 'vue';

/**
 * Onglets d'un espace de documentation, façon Obsidian : chacun montre un fichier (ou rien, page d'accueil) et garde son
 * propre historique pour ses flèches précédent / suivant. Ils sont retenus par espace dans ce navigateur.
 */

export interface DocTab {
  id: string;
  nodeId: number | null;
  back: Array<number | null>;
  forward: Array<number | null>;
}

const HISTORY_MAX = 50;
const TABS_MAX = 20;

const newId = (): string => Math.random().toString(36).slice(2, 10);
const blank = (nodeId: number | null = null): DocTab => ({ id: newId(), nodeId, back: [], forward: [] });

export function useDocTabs(spaceId: Ref<number>) {
  const tabs = ref<DocTab[]>([blank()]);
  const activeId = ref(tabs.value[0]!.id);
  const active = computed<DocTab>(() => tabs.value.find((tab) => tab.id === activeId.value) ?? tabs.value[0]!);

  const key = computed(() => `fb.docs.tabs.${spaceId.value}`);

  function restore(): void {
    try {
      const saved = JSON.parse(localStorage.getItem(key.value) ?? 'null') as { tabs: DocTab[]; active: string } | null;
      if (saved?.tabs?.length) {
        tabs.value = saved.tabs.slice(0, TABS_MAX).map((tab) => ({ id: String(tab.id), nodeId: typeof tab.nodeId === 'number' ? tab.nodeId : null, back: tab.back ?? [], forward: tab.forward ?? [] }));
        activeId.value = tabs.value.some((tab) => tab.id === saved.active) ? saved.active : tabs.value[0]!.id;
        return;
      }
    } catch {
      // Rien de lisible : on repart d'un onglet vide.
    }
    tabs.value = [blank()];
    activeId.value = tabs.value[0]!.id;
  }

  watch(key, restore, { immediate: true });
  watch(
    [tabs, activeId],
    () => {
      try {
        localStorage.setItem(key.value, JSON.stringify({ tabs: tabs.value, active: activeId.value }));
      } catch {
        // Stockage indisponible : les onglets valent pour cette page seulement.
      }
    },
    { deep: true },
  );

  /** Montre un fichier dans l'onglet actif, en le gardant dans son historique. */
  function navigate(nodeId: number | null): void {
    const tab = active.value;
    if (tab.nodeId === nodeId) return;
    tab.back = [...tab.back, tab.nodeId].slice(-HISTORY_MAX);
    tab.forward = [];
    tab.nodeId = nodeId;
  }

  function openInNewTab(nodeId: number | null): void {
    const existing = nodeId === null ? undefined : tabs.value.find((tab) => tab.nodeId === nodeId);
    if (existing) {
      activeId.value = existing.id;
      return;
    }
    const tab = blank(nodeId);
    const index = tabs.value.findIndex((entry) => entry.id === activeId.value);
    tabs.value.splice(index + 1, 0, tab);
    if (tabs.value.length > TABS_MAX) tabs.value.splice(tabs.value.findIndex((entry) => entry.id !== tab.id && entry.id !== activeId.value), 1);
    activeId.value = tab.id;
  }

  function activate(id: string): void {
    if (tabs.value.some((tab) => tab.id === id)) activeId.value = id;
  }

  function close(id: string): void {
    const index = tabs.value.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    if (tabs.value.length === 1) {
      tabs.value = [blank()];
      activeId.value = tabs.value[0]!.id;
      return;
    }
    tabs.value.splice(index, 1);
    if (activeId.value === id) activeId.value = (tabs.value[index] ?? tabs.value[index - 1])!.id;
  }

  function closeOthers(id: string): void {
    tabs.value = tabs.value.filter((tab) => tab.id === id);
    activeId.value = id;
  }

  function goBack(): void {
    const tab = active.value;
    if (!tab.back.length) return;
    tab.forward = [tab.nodeId, ...tab.forward].slice(0, HISTORY_MAX);
    tab.nodeId = tab.back.at(-1)!;
    tab.back = tab.back.slice(0, -1);
  }

  function goForward(): void {
    const tab = active.value;
    if (!tab.forward.length) return;
    tab.back = [...tab.back, tab.nodeId].slice(-HISTORY_MAX);
    tab.nodeId = tab.forward[0]!;
    tab.forward = tab.forward.slice(1);
  }

  /**
   * Le navigateur demande un fichier (précédent, suivant, lien) : l'onglet qui le montre déjà, sinon un pas dans
   * l'historique de l'onglet actif, sinon une navigation ordinaire.
   */
  function show(nodeId: number | null): void {
    const tab = active.value;
    if (tab.nodeId === nodeId) return;
    if (tab.back.length && tab.back.at(-1) === nodeId) return goBack();
    if (tab.forward.length && tab.forward[0] === nodeId) return goForward();
    const holder = nodeId === null ? undefined : tabs.value.find((entry) => entry.nodeId === nodeId);
    if (holder) activeId.value = holder.id;
    else navigate(nodeId);
  }

  /** Oublie les fichiers qui n'existent plus : leurs onglets se ferment, leur trace disparaît des historiques. */
  function prune(known: Set<number>): void {
    const alive = (id: number | null) => id === null || known.has(id);
    for (const tab of tabs.value) {
      tab.back = tab.back.filter(alive);
      tab.forward = tab.forward.filter(alive);
    }
    for (const tab of tabs.value.filter((entry) => !alive(entry.nodeId))) close(tab.id);
  }

  return { tabs, activeId, active, navigate, openInNewTab, activate, close, closeOthers, goBack, goForward, show, prune };
}
