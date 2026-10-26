/**
 * Google integration entry point. `startGoogleSync()` starts the background
 * Classroom sync: every 30 minutes, for each connected user with autoSync on.
 * Idempotent and never throws.
 */
import { getDb } from '../../db/connection';
import * as store from './store';
import { syncClassroom } from './sync';

export { syncClassroom } from './sync';
export { listUpcomingEvents, eventToTask } from './calendar';

const SYNC_INTERVAL_MS = 30 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 60 * 1000;

let started = false;

async function runAutoSync(): Promise<void> {
  try {
    const db = getDb();
    for (const u of store.listConnectedUserIds(db)) {
      if (!u.autoSync) continue;
      const row = store.getAuthRow(db, u.userId);
      // Skip when a (manual) sync ran recently.
      if (row?.last_sync_at && Date.now() - Date.parse(row.last_sync_at) < SYNC_INTERVAL_MS - 60_000) continue;
      await syncClassroom(db, u.userId);
    }
  } catch (err) {
    console.error('[Google sync] auto sync failed:', err);
  }
}

export function startGoogleSync(): void {
  if (started) return;
  started = true;
  try {
    const first = setTimeout(() => { void runAutoSync(); }, FIRST_RUN_DELAY_MS);
    first.unref?.();
    const timer = setInterval(() => { void runAutoSync(); }, SYNC_INTERVAL_MS);
    timer.unref?.();
  } catch (err) {
    console.error('[Google sync] could not start:', err);
  }
}
