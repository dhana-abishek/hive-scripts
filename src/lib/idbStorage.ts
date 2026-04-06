// IndexedDB-based storage for large CSV data that persists across refreshes/deploys

const DB_NAME = "warehouseFlowDB";
const STORE_NAME = "csvStore";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });

  return dbPromise;
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  executor: (store: IDBObjectStore, resolveValue: (value: T) => void, rejectValue: (error?: unknown) => void) => void,
): Promise<T> {
  return openDB().then(
    (db) => new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      let result: T;
      let settled = false;

      const resolveOnce = (value: T) => {
        result = value;
      };

      const rejectOnce = (error?: unknown) => {
        if (settled) return;
        settled = true;
        reject(error ?? tx.error ?? new Error("IndexedDB transaction failed"));
      };

      tx.oncomplete = () => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      tx.onerror = () => rejectOnce(tx.error);
      tx.onabort = () => rejectOnce(tx.error ?? new Error("IndexedDB transaction was aborted"));

      executor(store, resolveOnce, rejectOnce);
    }),
  );
}

export async function idbGet<T>(key: string): Promise<T | null> {
  try {
    return await runTransaction<T | null>("readonly", (store, resolveValue, rejectValue) => {
      const req = store.get(key);
      req.onsuccess = () => resolveValue((req.result as T | undefined) ?? null);
      req.onerror = () => rejectValue(req.error);
    });
  } catch {
    return null;
  }
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  await runTransaction<void>("readwrite", (store, resolveValue, rejectValue) => {
    const req = store.put(value, key);
    req.onsuccess = () => resolveValue(undefined);
    req.onerror = () => rejectValue(req.error);
  });
}

export async function idbRemove(key: string): Promise<void> {
  await runTransaction<void>("readwrite", (store, resolveValue, rejectValue) => {
    const req = store.delete(key);
    req.onsuccess = () => resolveValue(undefined);
    req.onerror = () => rejectValue(req.error);
  });
}
