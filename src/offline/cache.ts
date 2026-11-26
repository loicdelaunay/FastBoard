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
}

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

/** Garde (ou remplace) une entrée ; de temps en temps, les plus anciennes partent au-delà de la limite. */
export async function writeOffline(key: string, payload: unknown): Promise<void> {
  try {
    if (JSON.stringify(payload).length > OFFLINE_LIMITS.payloadChars) return;
  } catch {
    return;
  }
  await run('readwrite', (store) => store.put({ key, at: new Date().toISOString(), payload } satisfies Entry));
  writes += 1;
  if (writes % 50 === 0) await prune();
}

async function prune(): Promise<void> {
  const count = (await run<number>('readonly', (store) => store.count())) ?? 0;
  let extra = count - OFFLINE_LIMITS.entries;
  if (extra <= 0) return;
  await run('readwrite', (store) => {
    const cursor = store.index('at').openCursor();
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current || extra <= 0) return;
      current.delete();
      extra -= 1;
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
}
