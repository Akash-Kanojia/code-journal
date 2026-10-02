import { createLogger } from '../core/logger';
import { JournalWriter } from '../core/services/journal-writer';
import { SyncService } from '../core/services/sync-service';
import { GitHubAuth, type PendingDeviceFlow } from '../github/github-auth';
import { GitHubClient } from '../github/github-client';
import { GitHubRepositoryProvider } from '../github/github-repository';
import { IndexedDbStore } from '../storage/indexed-db';
import { loadSettings } from './settings';
import { ext } from '../ext';

const PENDING_FLOW_KEY = 'github.deviceFlow';
export const AUTH_ERROR_KEY = 'github.authError';

export interface Services {
  store: IndexedDbStore;
  auth: GitHubAuth;
  provider: GitHubRepositoryProvider;
  sync: SyncService;
}

/** Wakes/keeps the service worker alive: any extension API call resets its idle timer. */
export async function heartbeat(): Promise<void> {
  await ext.runtime.getPlatformInfo();
}

async function createServices(): Promise<Services> {
  const store = await IndexedDbStore.open();
  // Nothing can be mid-sync when the worker starts: "syncing" entries were interrupted.
  const interrupted = await store.recoverInterrupted(new Date());
  if (interrupted > 0)
    createLogger('sync').info('Recovered interrupted syncs', { count: interrupted });
  const authLogger = createLogger('github');
  const auth = new GitHubAuth({
    fetch: (...args) => fetch(...args),
    secrets: store,
    // Session storage is only readable by extension pages and the worker, never content scripts.
    pending: {
      get: async () =>
        (await ext.storage.session.get(PENDING_FLOW_KEY))[PENDING_FLOW_KEY] as
          PendingDeviceFlow | undefined,
      set: async (flow) => {
        if (flow === undefined) await ext.storage.session.remove(PENDING_FLOW_KEY);
        else await ext.storage.session.set({ [PENDING_FLOW_KEY]: flow });
      },
    },
    logger: authLogger,
    now: () => new Date(),
    sleep: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
  });
  const client = new GitHubClient({
    fetch: (...args) => fetch(...args),
    getToken: () => auth.getToken(),
  });
  const provider = new GitHubRepositoryProvider(client, () => auth.isAuthenticated());
  const syncLogger = createLogger('sync');
  const sync = new SyncService({
    store,
    writer: new JournalWriter(provider, syncLogger),
    logger: syncLogger,
    now: () => new Date(),
    heartbeat,
    isAuthenticated: () => auth.isAuthenticated(),
    onAuthRejected: async () => {
      await auth.disconnect();
      await ext.storage.local.set({
        [AUTH_ERROR_KEY]: 'GitHub rejected the saved credentials. Connect GitHub again.',
      });
    },
    getTarget: async () => {
      const settings = await loadSettings();
      if (settings.repository === undefined || settings.branch === undefined) return undefined;
      return {
        repository: { owner: settings.repository.owner, name: settings.repository.name },
        branch: settings.branch,
        directory: settings.directory,
      };
    },
  });
  return { store, auth, provider, sync };
}

let services: Promise<Services> | undefined;

/** Lazily created once per service-worker lifetime. */
export function getServices(): Promise<Services> {
  services ??= createServices().catch((error: unknown) => {
    services = undefined;
    throw error;
  });
  return services;
}
