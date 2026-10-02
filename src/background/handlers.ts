import type { Logger } from '../core/logger';
import { submissionKey } from '../core/models/coding-submission';
import type { CaptureAck, PopupRequest, SubmissionCapturedRequest } from '../core/types/messages';
import type { StatusView } from '../core/types/status';
import { resumeConnect, startConnect } from './auth-flow';
import { readLastSync, runSync } from './scheduler';
import { AUTH_ERROR_KEY, getServices } from './services';
import { applySettingsUpdate, effectiveClientId, loadSettings, saveSettings } from './settings';
import { ext } from '../ext';

const RECENT_LIMIT = 15;

export async function handleCapture(
  request: SubmissionCapturedRequest,
  logger: Logger,
): Promise<CaptureAck> {
  const { store } = await getServices();
  const { submission } = request;
  const key = submissionKey(submission);
  const { created } = await store.save(submission, new Date());
  if (created) {
    logger.info('Submission persisted and queued for sync', {
      key,
      problemId: submission.problem.id,
      status: submission.status,
    });
    void runSync(logger, 'captured');
  } else {
    logger.debug('Duplicate submission ignored', { key });
  }
  return { created, key };
}

export async function handlePopupRequest(request: PopupRequest, logger: Logger): Promise<unknown> {
  const { store, auth, provider } = await getServices();
  switch (request.type) {
    case 'GET_STATUS': {
      const [settings, authState, counts, recent, lastSync, authError] = await Promise.all([
        loadSettings(),
        auth.getState(),
        store.counts(),
        store.listRecent(RECENT_LIMIT),
        readLastSync(),
        ext.storage.local.get(AUTH_ERROR_KEY),
      ]);
      if (authState.status === 'pending') resumeConnect(logger);
      const view: StatusView = {
        auth: authState,
        ...(typeof authError[AUTH_ERROR_KEY] === 'string'
          ? { authError: authError[AUTH_ERROR_KEY] }
          : {}),
        clientIdConfigured: effectiveClientId(settings) !== undefined,
        settings: { ...settings, clientId: settings.clientId ?? '' },
        counts,
        ...(lastSync === undefined ? {} : { lastSync }),
        recent: recent.map(({ record, sync }) => ({
          key: record.key,
          platform: record.submission.platform,
          title: record.submission.problem.title,
          problemId: record.submission.problem.id,
          url: record.submission.problem.url,
          status: record.submission.status,
          submittedAt: record.submission.submittedAt,
          syncStatus: sync.status,
          ...(sync.lastError === undefined ? {} : { lastError: sync.lastError }),
          ...(sync.nextRetryAt === undefined ? {} : { nextRetryAt: sync.nextRetryAt }),
          ...(sync.path === undefined ? {} : { path: sync.path }),
        })),
      };
      return view;
    }
    case 'CONNECT_GITHUB':
      return startConnect(logger);
    case 'CANCEL_CONNECT':
      await auth.cancel();
      return null;
    case 'DISCONNECT_GITHUB':
      await auth.disconnect();
      return null;
    case 'LIST_REPOSITORIES': {
      const settings = await loadSettings();
      const repositories = await provider.getRepositories();
      return repositories.filter(
        (r) => r.canPush && (settings.allowPrivateRepositories || !r.private),
      );
    }
    case 'LIST_BRANCHES':
      return provider.getBranches({ owner: request.owner, name: request.name });
    case 'SAVE_SETTINGS': {
      const next = applySettingsUpdate(await loadSettings(), request.settings);
      await saveSettings(next);
      void runSync(logger, 'settings');
      return next;
    }
    case 'RETRY_FAILED': {
      const moved = await store.retryFailed(new Date());
      await store.clearBackoff(new Date());
      void runSync(logger, 'retry');
      return moved;
    }
    case 'SYNC_NOW':
      await store.clearBackoff(new Date());
      return runSync(logger, 'manual');
  }
}
