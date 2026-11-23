import { computed, onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from 'vue';
import type { Awareness } from 'y-protocols/awareness';
import { t } from '@/i18n';
import { notify } from '@/utils/notify';

/** Personne présente dans la salle (note ou tableau blanc), une entrée par personne même avec plusieurs onglets. */
export interface FollowPerson {
  id: number;
  name: string;
  color: string;
  colorLight?: string;
  /** Cette personne nous suit. */
  followsMe: boolean;
}

/** Délai laissé à la personne suivie pour réapparaître (changement de note, de tableau, coupure brève). */
const LOST_AFTER_MS = 5000;

/**
 * Suivre quelqu'un, comme dans Figma : on clique sur une personne présente et notre vue montre ce qu'elle regarde, jusqu'à
 * notre première action. Tout passe par la présence de la salle (Yjs awareness), sans rien de plus côté serveur :
 * - `following` : la personne que nous suivons (elle voit ainsi qui la suit) ;
 * - `goto` : posé juste avant de quitter la salle pour une autre note ou un autre tableau du même espace, pour que ceux
 *   qui nous suivent viennent avec nous ;
 * - `view` : ce que chacun regarde (publié par l'éditeur lui-même).
 */
export function useFollow(options: {
  /** Notre identifiant (personne connectée ou visiteur). */
  self: () => number | null | undefined;
  /** La personne suivie est partie sur cette note ou ce tableau : y aller. Renvoie faux si c'est impossible. */
  goTo?: (target: number) => boolean;
}): {
  people: Ref<FollowPerson[]>;
  following: Ref<number | null>;
  followed: ComputedRef<FollowPerson | null>;
  /** Présence de la personne suivie (son onglet actif le plus récemment) : on y lit ce qu'elle regarde. */
  followedState: Ref<Record<string, unknown> | null>;
  attach: (awareness: Awareness, clientId: number) => void;
  detach: (next?: number | null) => void;
  toggle: (person: FollowPerson) => void;
  stop: () => void;
  label: (person: FollowPerson, here: string) => string;
} {
  const people = ref<FollowPerson[]>([]);
  const following = ref<number | null>(null);
  const followedState = ref<Record<string, unknown> | null>(null);
  /** Nom gardé pour le message quand la personne a disparu. */
  let followedName = '';
  let current: { awareness: Awareness; clientId: number; read: () => void } | null = null;
  let lostTimer = 0;

  const followed = computed(() => people.value.find((person) => person.id === following.value) ?? null);

  function stop(): void {
    window.clearTimeout(lostTimer);
    lostTimer = 0;
    following.value = null;
  }

  /** La personne suivie n'est plus là : on lui laisse le temps de réapparaître, puis on arrête. */
  function watchLost(): void {
    if (following.value === null || followed.value) {
      window.clearTimeout(lostTimer);
      lostTimer = 0;
      return;
    }
    if (lostTimer) return;
    lostTimer = window.setTimeout(() => {
      lostTimer = 0;
      if (following.value === null || followed.value) return;
      notify('info', t('Suivi arrêté'), t('{name} n’est plus ici.', { name: followedName }));
      stop();
    }, LOST_AFTER_MS);
  }

  function read(awareness: Awareness, clientId: number): void {
    const self = options.self();
    const seen = new Map<number, FollowPerson>();
    let target: number | null = null;
    let shown: Record<string, unknown> | null = null;
    const movedAt = (state: Record<string, unknown> | null): number => Number((state?.view as { at?: unknown } | undefined)?.at) || 0;
    awareness.getStates().forEach((state, id) => {
      const user = state.user as { id?: number; name?: string; color?: string; colorLight?: string } | undefined;
      if (!user || typeof user.id !== 'number' || id === clientId || user.id === self) return;
      const known = seen.get(user.id);
      seen.set(user.id, { id: user.id, name: user.name ?? '', color: user.color ?? '#4f8cff', colorLight: user.colorLight, followsMe: Boolean(known?.followsMe) || (self != null && state.following === self) });
      if (user.id !== following.value) return;
      if (typeof state.goto === 'number') target = state.goto;
      if (!shown || movedAt(state) >= movedAt(shown)) shown = state;
    });
    people.value = [...seen.values()];
    followedState.value = shown;
    if (followed.value) followedName = followed.value.name;
    // La personne suivie change de note ou de tableau : on y va aussi (elle réapparaîtra dans la nouvelle salle).
    if (target !== null && options.goTo && !options.goTo(target)) {
      notify('info', t('Suivi arrêté'), t('{name} est sur une page que vous ne pouvez pas ouvrir.', { name: followedName }));
      stop();
      return;
    }
    watchLost();
  }

  /** Raccorde la présence d'une salle (à chaque note ou tableau ouvert). */
  function attach(awareness: Awareness, clientId: number): void {
    detach();
    const handler = (): void => read(awareness, clientId);
    current = { awareness, clientId, read: handler };
    awareness.on('change', handler);
    awareness.setLocalStateField('following', following.value);
    handler();
  }

  /**
   * Quitte la salle. `next` : la note ou le tableau où l'on va, annoncé à ceux qui nous suivent (à appeler avant de fermer
   * la session, qui retire notre présence).
   */
  function detach(next?: number | null): void {
    if (!current) return;
    if (next != null) current.awareness.setLocalStateField('goto', next);
    current.awareness.off('change', current.read);
    current = null;
    people.value = [];
    followedState.value = null;
    watchLost();
  }

  function toggle(person: FollowPerson): void {
    if (following.value === person.id) {
      stop();
      return;
    }
    // Se suivre l'un l'autre ferait tourner les deux vues en rond.
    if (person.followsMe) {
      notify('info', t('{name} vous suit déjà', { name: person.name }), t('Vous ne pouvez pas vous suivre l’un l’autre.'));
      return;
    }
    followedName = person.name;
    following.value = person.id;
  }

  watch(following, (id) => {
    current?.awareness.setLocalStateField('following', id);
    current?.read();
  });

  onBeforeUnmount(() => {
    window.clearTimeout(lostTimer);
    if (current) current.awareness.off('change', current.read);
    current = null;
  });

  /** Info-bulle d'un avatar : où est la personne, et ce que fait un clic. */
  function label(person: FollowPerson, here: string): string {
    if (following.value === person.id) return t('Vous suivez {name} · cliquez pour arrêter', { name: person.name });
    return person.followsMe ? `${here} · ${t('vous suit')}` : `${here} · ${t('cliquez pour suivre')}`;
  }

  return { people, following, followed, followedState, attach, detach, toggle, stop, label };
}
