import { computed, shallowRef } from 'vue';
import * as Y from 'yjs';
import { contains, layoutMind, mindRoot } from '@shared/boardGeometry';
import { elementGroup, isPlaced, newElementId, shiftConnector, TEXT_SIZE_PX, withGroup, type BoardElement, type MindElement, type PlacedElement } from '@shared/boards';
import type { BoardSessionLike } from '@/realtime/boardSession';

/** Origine des écritures faites ici : seules elles s'annulent avec Ctrl Z. */
export const LOCAL = Symbol('local');

/** Champs à changer d'un élément (les autres restent). */
type Patch = object;

/**
 * Modèle d'un tableau ouvert : les éléments de la carte Yjs, triés par ordre d'empilement et tenus à jour pour Vue,
 * et les opérations d'écriture (une transaction Yjs chacune, annulable).
 */
export class BoardModel {
  readonly session: BoardSessionLike;
  readonly elements = shallowRef<BoardElement[]>([]);
  readonly index = computed(() => new Map(this.elements.value.map((element) => [element.id, element])));
  readonly undoManager: Y.UndoManager;
  readonly canUndo = shallowRef(false);
  readonly canRedo = shallowRef(false);
  #frame = 0;

  constructor(session: BoardSessionLike) {
    this.session = session;
    this.undoManager = new Y.UndoManager(session.elements, { trackedOrigins: new Set([LOCAL]), captureTimeout: 400 });
    const stacks = (): void => {
      this.canUndo.value = this.undoManager.undoStack.length > 0;
      this.canRedo.value = this.undoManager.redoStack.length > 0;
    };
    this.undoManager.on('stack-item-added', stacks);
    this.undoManager.on('stack-item-popped', stacks);
    session.elements.observe(this.#schedule);
    this.#refresh();
  }

  destroy(): void {
    cancelAnimationFrame(this.#frame);
    this.session.elements.unobserve(this.#schedule);
    this.undoManager.destroy();
  }

  readonly #schedule = (): void => {
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.#refresh();
    });
  };

  #refresh(): void {
    this.elements.value = [...this.session.elements.values()].sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
  }

  /** Relit tout de suite (après une écriture, avant le prochain rendu). */
  flush(): void {
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    this.#refresh();
  }

  get(id: string): BoardElement | undefined {
    return this.session.elements.get(id);
  }

  transact(change: () => void): void {
    this.session.doc.transact(change, LOCAL);
    this.flush();
  }

  /** Coupe la fusion des modifications : la prochaine sera une étape d'annulation à part. */
  stopCapturing(): void {
    this.undoManager.stopCapturing();
  }

  nextZ(): number {
    let max = 0;
    for (const element of this.session.elements.values()) max = Math.max(max, element.z);
    return max + 1;
  }

  add(elements: BoardElement[]): void {
    if (!elements.length) return;
    this.transact(() => {
      for (const element of elements) this.session.elements.set(element.id, element);
    });
  }

  update(id: string, patch: Patch): void {
    this.updateMany(new Map([[id, patch]]));
  }

  updateMany(patches: ReadonlyMap<string, Patch>): void {
    if (!patches.size) return;
    this.transact(() => {
      for (const [id, patch] of patches) {
        const current = this.session.elements.get(id);
        if (!current) continue;
        // Une valeur `undefined` retire un réglage facultatif (épaisseur, animation…).
        const next: Record<string, unknown> = { ...current, ...patch };
        for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
        this.session.elements.set(id, next as unknown as BoardElement);
      }
    });
  }

  /** Supprime des éléments, avec les liens qui leur sont accrochés et les branches de carte mentale. */
  remove(ids: Iterable<string>): void {
    const doomed = new Set(ids);
    let grew = true;
    while (grew) {
      grew = false;
      for (const element of this.session.elements.values()) {
        if (doomed.has(element.id)) continue;
        const attached = element.type === 'connector' && ((element.from.id && doomed.has(element.from.id)) || (element.to.id && doomed.has(element.to.id)));
        const orphan = element.type === 'mind' && element.parent && doomed.has(element.parent);
        if (attached || orphan) {
          doomed.add(element.id);
          grew = true;
        }
      }
    }
    const roots = new Set<string>();
    const groups = new Set<string>();
    for (const id of doomed) {
      const element = this.session.elements.get(id);
      const group = element ? elementGroup(element) : null;
      if (group) groups.add(group);
      if (element?.type === 'mind' && element.parent && !doomed.has(element.parent)) {
        const root = mindRoot(this.session.elements as unknown as ReadonlyMap<string, BoardElement>, element.parent);
        if (root) roots.add(root.id);
      }
    }
    this.transact(() => {
      for (const id of doomed) this.session.elements.delete(id);
      this.#dissolveLoneGroups(groups);
    });
    for (const root of roots) this.layoutMind(root);
  }

  /** Range des éléments dans le groupe `group` (`null` : les sort de leur groupe) ; un groupe resté seul se défait. */
  regroup(ids: Iterable<string>, group: string | null): void {
    this.transact(() => {
      const left = new Set<string>();
      for (const id of ids) {
        const current = this.session.elements.get(id);
        if (!current) continue;
        const previous = elementGroup(current);
        if (previous && previous !== group) left.add(previous);
        this.session.elements.set(id, withGroup(current, group));
      }
      this.#dissolveLoneGroups(left);
    });
  }

  /** Défait ceux de ces groupes qui n'ont plus qu'un élément (dans une transaction). */
  #dissolveLoneGroups(groups: ReadonlySet<string>): void {
    if (!groups.size) return;
    const members = new Map<string, BoardElement[]>();
    for (const element of this.session.elements.values()) {
      const group = elementGroup(element);
      if (!group || !groups.has(group)) continue;
      const list = members.get(group);
      if (list) list.push(element);
      else members.set(group, [element]);
    }
    for (const [lone, ...others] of members.values()) if (lone && !others.length) this.session.elements.set(lone.id, withGroup(lone, null));
  }

  /** Copie des éléments, décalée, avec de nouveaux identifiants (les liens suivent leurs extrémités copiées). */
  duplicate(source: readonly BoardElement[], offset = { x: 24, y: 24 }): BoardElement[] {
    const ids = new Map(source.map((element) => [element.id, newElementId()]));
    // Une copie de modèle copiée devient une autre copie du même modèle.
    const instances = new Map<string, string>();
    const relink = <T extends BoardElement>(element: T): T => {
      if (!element.tpl) return element;
      if (!instances.has(element.tpl.inst)) instances.set(element.tpl.inst, newElementId());
      return { ...element, tpl: { ...element.tpl, inst: instances.get(element.tpl.inst)! } };
    };
    // Un groupe copié forme un nouveau groupe (pas celui de l'original), s'il garde au moins deux éléments.
    const groupCount = new Map<string, number>();
    for (const element of source) {
      const group = elementGroup(element);
      if (group) groupCount.set(group, (groupCount.get(group) ?? 0) + 1);
    }
    const groups = new Map([...groupCount].filter(([, count]) => count > 1).map(([group]) => [group, newElementId()]));
    const ownGroup = <T extends BoardElement>(element: T): T => {
      const group = elementGroup(element);
      return withGroup(element, group ? (groups.get(group) ?? null) : null);
    };
    let z = this.nextZ();
    const copies = source.map(relink).map(ownGroup).map((element): BoardElement => {
      const id = ids.get(element.id)!;
      if (element.type === 'connector') {
        const shifted = shiftConnector(element, offset.x, offset.y);
        const end = (side: typeof element.from) => ({ ...side, id: side.id ? (ids.get(side.id) ?? null) : null });
        return { ...element, ...shifted, id, z: z++, from: end(shifted.from), to: end(shifted.to) };
      }
      const moved = { ...element, id, z: z++, x: element.x + offset.x, y: element.y + offset.y };
      if (moved.type === 'mind') return { ...moved, parent: moved.parent ? (ids.get(moved.parent) ?? null) : null };
      if (moved.type === 'chart') return { ...moved, source: moved.source ? (ids.get(moved.source) ?? moved.source) : null };
      return moved;
    });
    // Un lien dont une extrémité n'est pas copiée reste accroché à l'original.
    for (const copy of copies) {
      if (copy.type !== 'connector') continue;
      const original = source.find((element) => ids.get(element.id) === copy.id) as typeof copy | undefined;
      if (!original) continue;
      if (original.from.id && !ids.has(original.from.id)) copy.from = { ...original.from };
      if (original.to.id && !ids.has(original.to.id)) copy.to = { ...original.to };
    }
    this.add(copies);
    return copies;
  }

  /** Premier ou dernier plan. */
  restack(ids: ReadonlySet<string>, front: boolean): void {
    const sorted = this.elements.value;
    const moving = sorted.filter((element) => ids.has(element.id));
    const others = sorted.filter((element) => !ids.has(element.id));
    const order = front ? [...others, ...moving] : [...moving, ...others];
    this.updateMany(new Map(order.map((element, position) => [element.id, { z: position + 1 }])));
  }

  /** Éléments posés à l'intérieur d'une section (ils bougent avec elle). */
  insideFrame(frame: PlacedElement): PlacedElement[] {
    return this.elements.value.filter((element): element is PlacedElement => isPlaced(element) && element.id !== frame.id && element.type !== 'frame' && contains(frame, element));
  }

  /** Recalcule les positions d'une carte mentale. */
  layoutMind(rootId: string): void {
    const moves = layoutMind(this.elements.value, rootId);
    if (moves.size) this.updateMany(moves);
  }

  undo(): void {
    this.undoManager.undo();
    this.flush();
  }

  redo(): void {
    this.undoManager.redo();
    this.flush();
  }
}

// --- Mesure du texte ---------------------------------------------------------------------------------------------------

let measurer: HTMLDivElement | null = null;

/** Hauteur qu'occupe un texte dans une largeur donnée (pour agrandir une forme qui déborde). */
export function measureText(text: string, width: number, fontSize: number, padding = 16): { width: number; height: number } {
  if (!measurer) {
    measurer = document.createElement('div');
    measurer.className = 'board-measure';
    document.body.append(measurer);
  }
  measurer.style.fontSize = `${fontSize}px`;
  measurer.style.width = width > 0 ? `${Math.max(1, width - padding * 2)}px` : 'auto';
  measurer.textContent = text || ' ';
  const rect = measurer.getBoundingClientRect();
  return { width: rect.width + padding * 2, height: rect.height + padding * 2 };
}

/** Taille d'un nœud de carte mentale d'après son texte. */
export function mindSize(node: Pick<MindElement, 'text' | 'parent'>): { w: number; h: number } {
  const fontSize = node.parent ? 14 : 17;
  const natural = measureText(node.text || '…', 0, fontSize, 14);
  const w = Math.min(320, Math.max(node.parent ? 90 : 140, natural.width));
  const h = Math.max(node.parent ? 36 : 48, measureText(node.text || '…', w, fontSize, 12).height);
  return { w: Math.round(w), h: Math.round(h) };
}

export const textPx = (size: keyof typeof TEXT_SIZE_PX): number => TEXT_SIZE_PX[size];
