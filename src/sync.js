/* ════════════════════════════════════════════════════════════
   sync.js — offline-first sync queue
   Every change: IndexedDB first (instant), Supabase queued with retry.
   Status: "local" | "syncing" | "synced" | "error" | "offline"
   ════════════════════════════════════════════════════════════ */
import { updateGame } from "./api.js";
import { dbGetGame, dbGetDirtyIds, dbMarkDirty, dbClearDirty } from "./db.js";

let statusCb = () => {};
let retryTimer = null;
let retryDelay = 2000;
let syncing = false;

export function onSyncStatus(cb) { statusCb = cb; }

function setStatus(s) { try { statusCb(s); } catch (e) {} }

export async function enqueue(gameId) {
  await dbMarkDirty(gameId);
  setStatus("local");
  void flush();
}

export async function flush() {
  if (syncing) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) { setStatus("offline"); scheduleRetry(); return; }
  syncing = true;
  try {
    const ids = await dbGetDirtyIds();
    if (ids.length === 0) { syncing = false; return; }
    setStatus("syncing");
    let allOk = true;
    for (const id of ids) {
      const game = await dbGetGame(id);
      if (!game) { await dbClearDirty(id); continue; }
      const ok = await updateGame(game);
      if (ok) { await dbClearDirty(id); }
      else { allOk = false; }
    }
    if (allOk) { setStatus("synced"); retryDelay = 2000; }
    else { setStatus("error"); scheduleRetry(); }
  } catch (e) {
    setStatus("error"); scheduleRetry();
  } finally {
    syncing = false;
  }
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { void flush(); }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 30000);
}

export function startSyncLoop() {
  if (typeof window !== "undefined") {
    window.addEventListener("online", () => { retryDelay = 2000; void flush(); });
    window.addEventListener("offline", () => setStatus("offline"));
  }
  void flush();
}
