import type { Logger } from '../core/logger';
import type { DeviceAuthorization } from '../github/github-auth';
import { ALARM_AUTH_POLL, runSync } from './scheduler';
import { AUTH_ERROR_KEY, getServices, heartbeat } from './services';
import { effectiveClientId, loadSettings, oauthScope } from './settings';
import { ext } from '../ext';

let polling: Promise<void> | undefined;

/** Starts the device flow; polling continues in the worker after the popup closes. */
export async function startConnect(logger: Logger): Promise<DeviceAuthorization> {
  const settings = await loadSettings();
  const clientId = effectiveClientId(settings);
  if (clientId === undefined) {
    throw new Error('Set a GitHub OAuth App client id first (see README → GitHub setup).');
  }
  const { auth } = await getServices();
  await ext.storage.local.remove(AUTH_ERROR_KEY);
  const authorization = await auth.start(clientId, oauthScope(settings));
  resumeConnect(logger);
  return authorization;
}

/** (Re)starts polling for a pending device flow — also after a service-worker restart. */
export function resumeConnect(logger: Logger): void {
  if (polling !== undefined) return;
  polling = (async () => {
    const { auth, provider } = await getServices();
    const state = await auth.getState();
    if (state.status !== 'pending') return;
    const clientId = effectiveClientId(await loadSettings());
    if (clientId === undefined) return;
    // A safety net in case the worker is stopped while waiting.
    await ext.alarms.create(ALARM_AUTH_POLL, { periodInMinutes: 0.5 });
    const result = await auth.waitForAuthorization(clientId, heartbeat);
    await ext.alarms.clear(ALARM_AUTH_POLL);
    if (result.status === 'connected') {
      provider.forgetIdentity();
      await runSync(logger, 'connected');
    } else if (result.status === 'failed') {
      logger.warn('GitHub authorization did not complete', { error: result.error });
      await ext.storage.local.set({ [AUTH_ERROR_KEY]: result.error });
    }
  })()
    .catch((error: unknown) => {
      logger.error('GitHub authorization polling failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      polling = undefined;
    });
}
