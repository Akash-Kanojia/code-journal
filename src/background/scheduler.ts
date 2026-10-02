import type { Logger } from '../core/logger';
import type { SyncRunResult } from '../core/services/sync-service';
import { getServices } from './services';
import { ext } from '../ext';

export const ALARM_SYNC_RETRY = 'sync-retry';
export const ALARM_SYNC_PERIODIC = 'sync-periodic';
export const ALARM_AUTH_POLL = 'auth-poll';

const LAST_SYNC_KEY = 'sync.last';
/** Chrome rejects alarms sooner than 30 s. */
const MIN_ALARM_DELAY_MS = 30_000;

export interface LastSync extends SyncRunResult {
  at: string;
  error?: string;
}

export async function readLastSync(): Promise<LastSync | undefined> {
  return (await ext.storage.local.get(LAST_SYNC_KEY))[LAST_SYNC_KEY] as LastSync | undefined;
}

export function ensurePeriodicAlarm(): void {
  void ext.alarms.create(ALARM_SYNC_PERIODIC, { periodInMinutes: 15 });
}

/** Runs the sync queue and schedules the next retry, if one is due later. */
export async function runSync(logger: Logger, reason: string): Promise<SyncRunResult | undefined> {
  try {
    const { sync } = await getServices();
    logger.debug('Sync triggered', { reason });
    const result = await sync.run();
    await ext.storage.local.set({
      [LAST_SYNC_KEY]: { ...result, at: new Date().toISOString() },
    });
    if (result.nextRetryAt !== undefined) {
      const when = Math.max(Date.parse(result.nextRetryAt), Date.now() + MIN_ALARM_DELAY_MS);
      await ext.alarms.create(ALARM_SYNC_RETRY, { when });
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Sync run failed', { reason, error: message });
    await ext.storage.local.set({
      [LAST_SYNC_KEY]: { synced: 0, failed: 0, at: new Date().toISOString(), error: message },
    });
    return undefined;
  }
}
