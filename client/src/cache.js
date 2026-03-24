import { openDB } from 'idb';

const DB_NAME = 'vmt-cache';
const DB_VERSION = 1;
const STORE_NAME = 'api-cache';

let dbPromise = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      },
    });
  }
  return dbPromise;
}

export async function getCached(key) {
  const db = await getDB();
  return db.get(STORE_NAME, key);
}

export async function setCache(key, data) {
  const db = await getDB();
  await db.put(STORE_NAME, { data, time: Date.now() }, key);
}

export async function deleteCacheByPrefix(prefix) {
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  let cursor = await store.openCursor();
  while (cursor) {
    if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
      cursor.delete();
    }
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function clearAllCache() {
  const db = await getDB();
  await db.clear(STORE_NAME);
}
