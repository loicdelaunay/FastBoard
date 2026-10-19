import type { t } from './index';

declare module 'vue' {
  interface ComponentCustomProperties {
    /** Traduit un texte (le français sert de clé). */
    $t: typeof t;
  }
}

export {};
