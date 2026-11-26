import { OFFLINE_LIMITS } from '@shared/offline';

/**
 * Ce que l'interface garde sur l'appareil pour la lecture hors ligne (IndexedDB) : les réponses de l'API déjà reçues,
 * le texte des notes et les éléments des tableaux ouverts. Chaque entrée appartient à un compte (une autre personne
 * connectée sur le même navigateur ne la lit pas) ; tout s'efface à la déconnexion. Sans IndexedDB (navigation privée
 * stricte…), rien n'est gardé et rien ne casse.
 */

interface Entry {
  key: string;
  at: string;
  payload: unknown;
  /** Espace gardé hors ligne à qui appartient l'entrée (`docs:12`, `project:3`) : le ménage ne la touche pas. */
  pin?: string;
}

/** Préfixe des caches d'images des espaces gardés hors ligne (un par espace : `fb-pinned-docs-12`). */
export const PINNED_CACHE_PREFIX = 'fb-pinned-';

const DB_NAME = 'fastboard-offline';
const STORE = 'entries';
let opening: Promise<IDBDatabase | null> | null = null;
let writes = 0;

function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('at', 'at');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const transaction = db.transaction(STORE, mode);
          const request = work(transaction.objectStore(STORE));
          transaction.oncomplete = () => resolve(request ? (request.result ?? null) : null);
          transaction.onerror = () => resolve(null);
          transaction.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

/** Clé d'une entrée : le compte, puis ce qu'elle garde (`api:/projects`, `doc:12`, `board:7`). */
export const offlineKey = (userId: number, what: string): string => `${userId}|${what}`;

export async function readOffline<T>(key: string): Promise<{ payload: T; at: string } | null> {
  const entry = await run<Entry | undefined>('readonly', (store) => store.get(key));
  return entry ? { payload: entry.payload as T, at: entry.at } : null;
}

/**
 * Garde (ou remplace) une entrée ; `pin` la rattache à un espace gardé hors ligne. Une entrée déjà rattachée le reste
 * quand la navigation la met à jour. De temps en temps, les plus anciennes non rattachées partent au-delà de la limite.
 */
export async function writeOffline(key: string, payload: unknown, pin?: string): Promise<void> {
  try {
    if (JSON.stringify(payload).length > OFFLINE_LIMITS.payloadChars) return;
  } catch {
    return;
  }
  await run('readwrite', (store) => {
    const existing = store.get(key);
    existing.onsuccess = () => {
      const kept = pin ?? (existing.result as Entry | undefined)?.pin;
      store.put({ key, at: new Date().toISOString(), payload, ...(kept ? { pin: kept } : {}) } satisfies Entry);
    };
  });
  writes += 1;
  if (writes % 50 === 0) await prune();
}

async function prune(): Promise<void> {
  // Seules les entrées de la navigation comptent : celles des espaces gardés hors ligne restent.
  let loose = 0;
  await run('readonly', (store) => {
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current) return;
      if (!(current.value as Entry).pin) loose += 1;
      current.continue();
    };
  });
  let extra = loose - OFFLINE_LIMITS.entries;
  if (extra <= 0) return;
  await run('readwrite', (store) => {
    const cursor = store.index('at').openCursor();
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current || extra <= 0) return;
      if (!(current.value as Entry).pin) {
        current.delete();
        extra -= 1;
      }
      current.continue();
    };
  });
}

/** Détache les entrées d'un espace qui n'est plus gardé hors ligne (elles redeviennent un cache ordinaire). */
export async function unpinOffline(pin: string): Promise<void> {
  await run('readwrite', (store) => {
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current) return;
      const entry = current.value as Entry;
      if (entry.pin === pin) {
        const { pin: _dropped, ...rest } = entry;
        current.update(rest);
      }
      current.continue();
    };
  });
}

/** Efface tout ce qui est gardé (déconnexion, changement de compte), y compris les images gardées par le service worker. */
export async function clearOffline(): Promise<void> {
  await run('readwrite', (store) => store.clear());
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'fastboard:clear-offline' });
  } catch {
    // Pas de service worker : rien d'autre à effacer.
  }
  // Les espaces gardés hors ligne (leur liste sur cet appareil, leurs images) partent aussi.
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith('fb.offline.pinned.')) localStorage.removeItem(key);
  } catch {
    // Stockage indisponible : rien à effacer.
  }
  try {
    if (typeof caches !== 'undefined') for (const name of await caches.keys()) if (name.startsWith(PINNED_CACHE_PREFIX)) await caches.delete(name);
  } catch {
    // Pas de cache (connexion non sécurisée) : rien à effacer.
  }
}
