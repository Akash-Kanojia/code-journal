import { createLogger } from '../core/logger';
import {
  isPopupRequest,
  isSubmissionCapturedRequest,
  type RuntimeResponse,
} from '../core/types/messages';
import { resumeConnect } from './auth-flow';
import { handleCapture, handlePopupRequest } from './handlers';
import {
  ALARM_AUTH_POLL,
  ALARM_SYNC_PERIODIC,
  ALARM_SYNC_RETRY,
  ensurePeriodicAlarm,
  runSync,
} from './scheduler';
import { getServices } from './services';
import { ext } from '../ext';

const logger = createLogger();

/** Recovers work interrupted by a worker/browser shutdown, then drains the queue. */
async function recover(reason: string): Promise<void> {
  try {
    await getServices();
  } catch (error) {
    logger.error('Startup recovery failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  ensurePeriodicAlarm();
  resumeConnect(logger);
  await runSync(logger, reason);
}

function respond(sendResponse: (response: RuntimeResponse) => void, work: Promise<unknown>): true {
  work
    .then((data) => {
      sendResponse({ ok: true, data });
    })
    .catch((error: unknown) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
  return true;
}

function isFromExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === ext.runtime.id &&
    sender.tab === undefined &&
    sender.url?.startsWith(ext.runtime.getURL('')) === true
  );
}

// Listeners are registered synchronously at top level, as MV3 requires.
ext.runtime.onInstalled.addListener((details) => {
  logger.info('Extension installed', { reason: details.reason });
  void recover('installed');
});

ext.runtime.onStartup.addListener(() => {
  void recover('startup');
});

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_SYNC_RETRY || alarm.name === ALARM_SYNC_PERIODIC) {
    void runSync(logger, alarm.name);
  } else if (alarm.name === ALARM_AUTH_POLL) {
    resumeConnect(logger);
  }
});

ext.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== ext.runtime.id) return false;
  if (isSubmissionCapturedRequest(message)) {
    // Content scripts may only submit captures; they never receive credentials or settings.
    return respond(sendResponse, handleCapture(message, logger));
  }
  if (isPopupRequest(message)) {
    if (!isFromExtensionPage(sender)) {
      logger.warn('Rejected privileged message from a non-extension context', {
        type: message.type,
      });
      sendResponse({ ok: false, error: 'Not allowed' } satisfies RuntimeResponse);
      return false;
    }
    return respond(sendResponse, handlePopupRequest(message, logger));
  }
  logger.warn('Ignoring unrecognised runtime message', { tabId: sender.tab?.id });
  return false;
});

logger.info('Background service worker started');
