import { createLogger } from '../core/logger';
import { SubmissionLifecycleTracker } from '../core/services/submission-lifecycle';
import type {
  CaptureAck,
  RuntimeResponse,
  SubmissionCapturedRequest,
} from '../core/types/messages';
import { createAdapterRegistry } from './adapters';
import { deliverSubmission } from './deliver';
import { listenForImportCommands } from './history-import';
import { ext } from '../ext';

const logger = createLogger('content');

function main(): void {
  const url = new URL(window.location.href);
  const adapter = createAdapterRegistry().findForUrl(url);
  if (adapter === undefined) {
    logger.debug('No adapter registered for this page');
    return;
  }
  logger.info('Adapter started', { platform: adapter.platform });
  listenForImportCommands(adapter, logger);

  const tracker = new SubmissionLifecycleTracker(createLogger('lifecycle'));
  const send = (request: SubmissionCapturedRequest) =>
    ext.runtime.sendMessage<SubmissionCapturedRequest, RuntimeResponse<CaptureAck> | undefined>(
      request,
    );

  // The adapter keeps observing across SPA navigations: it listens to network traffic, not the DOM.
  adapter.start((event) => {
    tracker.handle(event);
    if (event.type !== 'SUBMISSION_NORMALIZED') return;
    const { submission } = event;
    void deliverSubmission(submission, send, logger).then((ack) => {
      tracker.markPersisted(submission.platform, submission.id, ack !== undefined, ack?.created);
    });
  });
}

main();
