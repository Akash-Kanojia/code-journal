import type { PlatformAdapter } from '../../core/adapters/platform-adapter';
import { createLogger, type Logger } from '../../core/logger';
import { isCompleteProblem, type ProblemReference } from '../../core/models/problem';
import type { SubmissionEventListener } from '../../core/models/submission-event';
import { subscribeToBridge, type BridgeMessage } from '../shared/bridge';
import { InFlightSubmissions } from '../shared/in-flight';
import { classifyGfgRequest, GFG_CHANNEL, GFG_ORIGIN, lookupProblem, problemUrl } from './gfg-api';
import {
  normalizeGfgResult,
  parseResultResponse,
  type GfgResultResponse,
  type GfgSubmissionContext,
} from './parsers/result';
import { parseResultRequest, parseSubmitRequest, parseSubmitResponse } from './parsers/submit';

export interface GfgAdapterDeps {
  /** Subscribes to messages from the MAIN-world page script. Returns an unsubscribe function. */
  subscribe(handler: (message: BridgeMessage) => void): () => void;
  lookupProblem(slug: string): Promise<ProblemReference>;
  now(): Date;
  logger: Logger;
}

interface Tracked {
  slug: string;
  context: GfgSubmissionContext;
}

/**
 * GeeksforGeeks practice problems. Submit posts the code as FormData to
 * `…/problems/{slug}/submit/compile/`, which returns a submission id; the page then polls
 * `…/problems/submission/submit/result/` with that id until judging finishes.
 */
export class GfgAdapter implements PlatformAdapter {
  readonly platform = 'gfg' as const;

  private readonly inFlight = new InFlightSubmissions<Tracked>();

  constructor(private readonly deps: GfgAdapterDeps) {}

  canHandle(url: URL): boolean {
    return url.origin === GFG_ORIGIN;
  }

  start(listener: SubmissionEventListener): () => void {
    return this.deps.subscribe((message) => {
      this.handleMessage(message, listener);
    });
  }

  private handleMessage(message: BridgeMessage, listener: SubmissionEventListener): void {
    let url: URL;
    try {
      url = new URL(message.url);
    } catch {
      return;
    }
    const request = classifyGfgRequest(url, message.method);
    if (request?.kind === 'submit') {
      this.handleSubmit(request.slug, message, listener);
    } else if (request?.kind === 'result') {
      this.handleResult(message, listener);
    }
  }

  private handleSubmit(
    slug: string,
    message: BridgeMessage,
    listener: SubmissionEventListener,
  ): void {
    const detectedAt = this.deps.now().toISOString();
    const submitted = parseSubmitRequest(message.requestForm);
    if (submitted.requestType !== undefined && submitted.requestType !== 'solutionCheck') {
      return;
    }
    const response =
      message.status === 200
        ? parseSubmitResponse(message.responseBody)
        : { ok: false as const, reason: `Submit request returned HTTP ${String(message.status)}` };
    if (!response.ok) {
      listener({
        type: 'SUBMISSION_CAPTURE_FAILED',
        platform: this.platform,
        reason: response.reason,
      });
      return;
    }
    const { submissionId } = response;
    if (this.inFlight.has(submissionId)) return;

    const context: GfgSubmissionContext = {
      submissionId,
      problem: { platform: this.platform, url: problemUrl(slug), slug },
      detectedAt,
    };
    if (submitted.language !== undefined) context.language = submitted.language;
    if (submitted.userCode !== undefined) context.code = submitted.userCode;

    this.inFlight.start(submissionId, { slug, context }, async (tracked) => {
      tracked.context.problem = await this.resolveProblem(slug);
      listener({
        type: 'SUBMISSION_STARTED',
        platform: this.platform,
        submissionId,
        problem: tracked.context.problem,
        ...(context.language === undefined ? {} : { language: context.language }),
        detectedAt,
      });
    });
  }

  private resolveProblem(slug: string): Promise<ProblemReference> {
    return this.deps.lookupProblem(slug).catch((error: unknown) => {
      this.deps.logger.warn('Problem lookup failed', {
        slug,
        error: error instanceof Error ? error.message : String(error),
      });
      return { platform: this.platform, url: problemUrl(slug), slug } satisfies ProblemReference;
    });
  }

  private handleResult(message: BridgeMessage, listener: SubmissionEventListener): void {
    const { submissionId } = parseResultRequest(message.requestForm);
    if (submissionId === undefined) return;

    this.inFlight.enqueue(submissionId, async (tracked) => {
      if (tracked === undefined) {
        // Not started in this page, or already handled: GFG exposes no way to recover the code.
        return;
      }
      const result = message.status === 200 ? parseResultResponse(message.responseBody) : undefined;
      if (result === undefined) {
        // GFG retries failed polls itself; only give up on a malformed success response.
        if (message.status === 200) {
          this.inFlight.finish(submissionId);
          listener({
            type: 'SUBMISSION_CAPTURE_FAILED',
            platform: this.platform,
            submissionId,
            reason: 'Unrecognised result response',
          });
        }
        return;
      }
      if (result.phase === 'judging') {
        listener({
          type: 'SUBMISSION_JUDGING',
          platform: this.platform,
          submissionId,
          platformState: result.state,
        });
        return;
      }
      this.inFlight.finish(submissionId);
      if (result.phase === 'evaluation_failed') {
        listener({
          type: 'SUBMISSION_CAPTURE_FAILED',
          platform: this.platform,
          submissionId,
          reason: 'GFG could not evaluate the submission',
        });
        return;
      }
      listener({
        type: 'SUBMISSION_RESULT_RECEIVED',
        platform: this.platform,
        submissionId,
        raw: result.raw,
      });
      await this.normalize(tracked, result, listener);
    });
  }

  private async normalize(
    tracked: Tracked,
    result: GfgResultResponse,
    listener: SubmissionEventListener,
  ): Promise<void> {
    const { context } = tracked;
    if (!isCompleteProblem(context.problem)) {
      context.problem = await this.resolveProblem(tracked.slug);
    }
    const normalized = normalizeGfgResult(result.raw, context);
    if (normalized.ok) {
      listener({
        type: 'SUBMISSION_NORMALIZED',
        platform: this.platform,
        submission: normalized.submission,
      });
    } else {
      listener({
        type: 'SUBMISSION_PARSING_FAILED',
        platform: this.platform,
        submissionId: context.submissionId,
        reason: normalized.reason,
        raw: result.raw,
      });
    }
  }
}

export function createGfgAdapter(): GfgAdapter {
  return new GfgAdapter({
    logger: createLogger('gfg'),
    now: () => new Date(),
    lookupProblem: (slug) =>
      lookupProblem(slug, {
        fetch: (...args) => fetch(...args),
        readNextData: () => document.getElementById('__NEXT_DATA__')?.textContent ?? undefined,
      }),
    subscribe: (handler) => subscribeToBridge(GFG_CHANNEL, handler),
  });
}
