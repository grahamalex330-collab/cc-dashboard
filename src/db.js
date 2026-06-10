/* ════════════════════════════════════════════════════════════
   db.js — IndexedDB storage layer (no dependencies)
   Stores: games (full game objects), meta (dirty flags)
   Safari treats IndexedDB as persistent; localStorage gets evicted.
   ════════════════════════════════════════════════════════════ */

const DB_NAME = "shotchart";
const DB_VERSION = 1;
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("games")) db.createObjectStore("games", { keyPath: "id" });
      if (!db.objectStoreNames.contains("dirty")) db.createObjectStore("dirty", { keyPath: "gameId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function dbPutGame(game) {
  const db = await openDb();
  return tx(db, "games", "readwrite", s => s.put(game));
}

export async function dbGetGame(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction("games", "readonly");
    const req = t.objectStore("games").get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function dbGetAllGames() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction("games", "readonly");
    const req = t.objectStore("games").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function dbDeleteGame(id) {
  const db = await openDb();
  await tx(db, "games", "readwrite", s => s.delete(id));
  await tx(db, "dirty", "readwrite", s => s.delete(id));
}

/* Dirty flags = games with local changes not yet confirmed by Supabase */
export async function dbMarkDirty(gameId) {
  const db = await openDb();
  return tx(db, "dirty", "readwrite", s => s.put({ gameId, at: Date.now() }));
}

export async function dbClearDirty(gameId) {
  const db = await openDb();
  return tx(db, "dirty", "readwrite", s => s.delete(gameId));
}

export async function dbGetDirtyIds() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction("dirty", "readonly");
    const req = t.objectStore("dirty").getAll();
    req.onsuccess = () => resolve((req.result || []).map(r => r.gameId));
    req.onerror = () => reject(req.error);
  });
}

export function dbAvailable() {
  try { return typeof indexedDB !== "undefined"; } catch (e) { return false; }
}
