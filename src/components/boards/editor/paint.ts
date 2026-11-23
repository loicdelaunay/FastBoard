import type { InjectionKey, Ref } from 'vue';

/**
 * Compteur fourni par le tableau à ce qu'il contient : il change quand les couleurs du tableau changent sans que le thème
 * de la page ne bouge (export dans un autre thème). Ce qui se dessine en JavaScript (graphiques) se redessine alors tout
 * de suite, avant la capture.
 */
export const BOARD_REPAINT: InjectionKey<Ref<number>> = Symbol('board-repaint');
