/**
 * Tiny promise wrapper over IndexedDB. Local-first: every flow, profile, run and version
 * lives on the device; sync (optional) uploads encrypted copies.
 */
const DB_NAME = "autoflow";
const DB_VERSION = 1;
export const STORES = ["flows", "profiles", "runs", "versions", "kv"] as const;
export type StoreName = (typeof STORES)[number];

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("flows")) db.createObjectStore("flows", { keyPath: "id" });
      if (!db.objectStoreNames.contains("profiles")) db.createObjectStore("profiles", { keyPath: "id" });
      if (!db.objectStoreNames.contains("runs")) {
        const s = db.createObjectStore("runs", { keyPath: "id" });
        s.createIndex("flowId", "flowId");
        s.createIndex("startedAt", "startedAt");
      }
      if (!db.objectStoreNames.contains("versions")) {
        const s = db.createObjectStore("versions", { keyPath: "key" });
        s.createIndex("flowId", "flowId");
      }
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("database is blocked by another tab"));
  });
  return dbp;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store: StoreName, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await open();
  return db.transaction(store, mode).objectStore(store);
}

export const db = {
  async all<T>(store: StoreName): Promise<T[]> {
    return wrap((await tx(store, "readonly")).getAll()) as Promise<T[]>;
  },
  async get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
    return wrap((await tx(store, "readonly")).get(key)) as Promise<T | undefined>;
  },
  async put<T>(store: StoreName, value: T, key?: IDBValidKey): Promise<void> {
    await wrap((await tx(store, "readwrite")).put(value, key));
  },
  async delete(store: StoreName, key: IDBValidKey): Promise<void> {
    await wrap((await tx(store, "readwrite")).delete(key));
  },
  async byIndex<T>(store: StoreName, index: string, value: IDBValidKey): Promise<T[]> {
    return wrap((await tx(store, "readonly")).index(index).getAll(value)) as Promise<T[]>;
  },
  async clear(store: StoreName): Promise<void> {
    await wrap((await tx(store, "readwrite")).clear());
  },
  async clearAll(): Promise<void> {
    for (const s of STORES) await this.clear(s);
  },
};

export const kv = {
  get: <T>(key: string) => db.get<T>("kv", key),
  set: <T>(key: string, value: T) => db.put("kv", value, key),
  del: (key: string) => db.delete("kv", key),
};
