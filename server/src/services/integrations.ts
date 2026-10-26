/**
 * Boot hook for the "Bağlantılar" background jobs: reminder/digest scheduler
 * (ntfy), automatic daily backup and the optional local-AI summary queue.
 * Each job does nothing until the user enables it in the UI.
 * Idempotent; never throws. Call once from node.ts after the DB is ready.
 */
import { startReminders } from './reminders';
import { startAutoBackup } from './backup';
import { startAiQueue } from './ollama';

let started = false;

export function startIntegrations(): void {
  if (started) return;
  started = true;
  for (const [name, fn] of [
    ['reminders', startReminders],
    ['auto-backup', startAutoBackup],
    ['ai-queue', startAiQueue],
  ] as const) {
    try {
      fn();
    } catch (err) {
      console.error(`[Integrations] ${name} failed to start:`, err);
    }
  }
  console.log('[Integrations] background jobs scheduled');
}
