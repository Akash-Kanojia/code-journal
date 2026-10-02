import type { Logger } from '../core/logger';
import type { CodingSubmission } from '../core/models/coding-submission';
import type {
  CaptureAck,
  RuntimeResponse,
  SubmissionCapturedRequest,
} from '../core/types/messages';

export type SendMessage = (
  request: SubmissionCapturedRequest,
) => Promise<RuntimeResponse<CaptureAck> | undefined>;

const RETRY_DELAYS_MS = [500, 2000, 5000];

/**
 * Hands a captured submission to the background worker, which persists it. Retries briefly
 * because the worker may be starting up. The background dedupes, so retrying is safe.
 */
export async function deliverSubmission(
  submission: CodingSubmission,
  send: SendMessage,
  logger: Logger,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<CaptureAck | undefined> {
  const request: SubmissionCapturedRequest = { type: 'SUBMISSION_CAPTURED', submission };
  for (let attempt = 0; ; attempt++) {
    let error: string;
    try {
      const response = await send(request);
      if (response?.ok === true) return response.data;
      error = response === undefined ? 'No response from background worker' : response.error;
    } catch (thrown) {
      error = thrown instanceof Error ? thrown.message : String(thrown);
      if (/context invalidated/i.test(error)) {
        // The extension was reloaded; this page's content script is orphaned.
        logger.error('Extension was reloaded; reload the page to keep capturing', {
          submissionId: submission.id,
        });
        return undefined;
      }
    }
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay === undefined) {
      logger.error('Submission persist failed', { submissionId: submission.id, error });
      return undefined;
    }
    await sleep(delay);
  }
}
