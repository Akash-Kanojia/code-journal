import type {
  HistoryImporter,
  HistoryImportSink,
  PlatformAdapter,
} from '../../core/adapters/platform-adapter';
import { createLogger, type Logger } from '../../core/logger';
import { isCompleteProblem, type ProblemReference } from '../../core/models/problem';
import type { SubmissionEventListener } from '../../core/models/submission-event';
import { subscribeToBridge, type BridgeMessage } from '../shared/bridge';
import { InFlightSubmissions } from '../shared/in-flight';
import { LeetCodeHistoryImporter, type HistoryImporterDeps } from './history-importer';
import {
  classifyLeetCodeRequest,
  fetchHistoryPage,
  fetchSubmissionDetails,
  fetchSubmissionRecord,
  LEETCODE_CHANNEL,
  LEETCODE_ORIGIN,
  lookupProblem,
  problemUrl,
} from './leetcode-api';
import { parseCheckResponse, type LeetCodeCheckResponse } from './parsers/check';
import type { LeetCodeSubmissionDetails } from './parsers/details';
import { toProblemReference } from './parsers/question';
import { normalizeCheckResult, type LeetCodeSubmissionContext } from './parsers/result';
import { parseSubmitRequest, parseSubmitResponse } from './parsers/submit';

export interface LeetCodeAdapterDeps {
  /** Subscribes to messages from the MAIN-world page script. Returns an unsubscribe function. */
  subscribe(handler: (message: BridgeMessage) => void): () => void;
  lookupProblem(slug: string): Promise<ProblemReference>;
  /** Recovers code/language of a submission whose submit request was not observed. */
  fetchSubmissionDetails(submissionId: string): Promise<LeetCodeSubmissionDetails | undefined>;
  now(): Date;
  logger: Logger;
  /** LeetCode requests and timing used by the history import. */
  history?: Pick<HistoryImporterDeps, 'fetchPage' | 'fetchDetails' | 'sleep'>;
}

interface Tracked {
  slug: string;
  context: LeetCodeSubmissionContext;
}

export class LeetCodeAdapter implements PlatformAdapter {
  readonly platform = 'leetcode' as const;

  /** Submissions awaiting a final result. Code is held in memory only until then. */
  private readonly inFlight = new InFlightSubmissions<Tracked>();
  /** Submissions whose final result was handled (or recovered), so repeated polls are ignored. */
  private readonly completed = new Set<string>();

  constructor(private readonly deps: LeetCodeAdapterDeps) {}

  canHandle(url: URL): boolean {
    return url.origin === LEETCODE_ORIGIN;
  }

  start(listener: SubmissionEventListener): () => void {
    return this.deps.subscribe((message) => {
      this.handleMessage(message, listener);
    });
  }

  createHistoryImporter(sink: HistoryImportSink): HistoryImporter {
    const { history } = this.deps;
    if (history === undefined) throw new Error('History import is not configured');
    return new LeetCodeHistoryImporter({
      ...history,
      ...sink,
      now: () => this.deps.now(),
      logger: this.deps.logger,
    });
  }

  private handleMessage(message: BridgeMessage, listener: SubmissionEventListener): void {
    let url: URL;
    try {
      url = new URL(message.url);
    } catch {
      return;
    }
    const request = classifyLeetCodeRequest(url, message.method);
    if (request?.kind === 'submit') {
      this.handleSubmit(request.slug, message, listener);
    } else if (request?.kind === 'check') {
      this.handleCheck(request.submissionId, message, listener);
    }
  }

  private handleSubmit(
    slug: string,
    message: BridgeMessage,
    listener: SubmissionEventListener,
  ): void {
    const detectedAt = this.deps.now().toISOString();
    const submissionId =
      message.status === 200 ? parseSubmitResponse(message.responseBody) : undefined;
    if (submissionId === undefined) {
      listener({
        type: 'SUBMISSION_CAPTURE_FAILED',
        platform: this.platform,
        reason:
          message.status === 200
            ? 'Submit response did not contain a submission id'
            : `Submit request returned HTTP ${String(message.status)}`,
      });
      return;
    }
    if (this.inFlight.has(submissionId)) return;

    const { lang, typedCode } = parseSubmitRequest(message.requestBody);
    const context: LeetCodeSubmissionContext = {
      submissionId,
      problem: { platform: this.platform, url: problemUrl(slug), slug },
      detectedAt,
    };
    if (lang !== undefined) context.language = lang;
    if (typedCode !== undefined) context.code = typedCode;

    this.inFlight.start(submissionId, { slug, context }, async (tracked) => {
      tracked.context.problem = await this.resolveProblem(slug);
      this.emitStarted(tracked.context, listener);
    });
  }

  private emitStarted(context: LeetCodeSubmissionContext, listener: SubmissionEventListener): void {
    listener({
      type: 'SUBMISSION_STARTED',
      platform: this.platform,
      submissionId: context.submissionId,
      problem: context.problem,
      ...(context.language === undefined ? {} : { language: context.language }),
      detectedAt: context.detectedAt,
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

  private handleCheck(
    submissionId: string,
    message: BridgeMessage,
    listener: SubmissionEventListener,
  ): void {
    this.inFlight.enqueue(submissionId, async (tracked) => {
      const check = message.status === 200 ? parseCheckResponse(message.responseBody) : undefined;
      if (check === undefined) {
        if (tracked === undefined) return;
        this.inFlight.finish(submissionId);
        listener({
          type: 'SUBMISSION_CAPTURE_FAILED',
          platform: this.platform,
          submissionId,
          reason: `Unrecognised check response (HTTP ${String(message.status)})`,
        });
        return;
      }
      if (!check.finished) {
        if (tracked === undefined) return;
        listener({
          type: 'SUBMISSION_JUDGING',
          platform: this.platform,
          submissionId,
          platformState: check.state,
        });
        return;
      }
      if (tracked === undefined) {
        await this.recover(submissionId, check, listener);
        return;
      }
      this.inFlight.finish(submissionId);
      this.completed.add(submissionId);
      listener({
        type: 'SUBMISSION_RESULT_RECEIVED',
        platform: this.platform,
        submissionId,
        raw: check.raw,
      });
      await this.normalize(tracked, check, listener);
    });
  }

  /**
   * A final result for a submission whose submit request was not observed (page refreshed
   * while judging, or the extension was reloaded). The code is recovered from LeetCode's
   * stored copy of the submission, which is what was judged.
   */
  private async recover(
    submissionId: string,
    check: LeetCodeCheckResponse,
    listener: SubmissionEventListener,
  ): Promise<void> {
    if (this.completed.has(submissionId)) return;
    this.completed.add(submissionId);
    const details = await this.deps.fetchSubmissionDetails(submissionId);
    const slug = details?.question?.titleSlug;
    if (details === undefined || slug === undefined) {
      listener({
        type: 'SUBMISSION_CAPTURE_FAILED',
        platform: this.platform,
        submissionId,
        reason: 'Result observed without its submit request, and recovery failed',
      });
      return;
    }
    this.deps.logger.info('Recovering submission from LeetCode submission details', {
      submissionId,
    });
    let problem = toProblemReference(problemUrl(slug), slug, details.question);
    if (!isCompleteProblem(problem)) problem = await this.resolveProblem(slug);
    const context: LeetCodeSubmissionContext = {
      submissionId,
      problem,
      code: details.code,
      detectedAt: details.submittedAt ?? this.deps.now().toISOString(),
    };
    if (details.language !== undefined) context.language = details.language;
    this.emitStarted(context, listener);
    listener({
      type: 'SUBMISSION_RESULT_RECEIVED',
      platform: this.platform,
      submissionId,
      raw: check.raw,
    });
    await this.normalize({ slug, context }, check, listener);
  }

  private async normalize(
    tracked: Tracked,
    check: LeetCodeCheckResponse,
    listener: SubmissionEventListener,
  ): Promise<void> {
    const { context } = tracked;
    if (!isCompleteProblem(context.problem)) {
      // The lookup at submit time may have failed transiently; try once more.
      context.problem = await this.resolveProblem(tracked.slug);
    }
    const result = normalizeCheckResult(check.raw, context);
    if (result.ok) {
      listener({
        type: 'SUBMISSION_NORMALIZED',
        platform: this.platform,
        submission: result.submission,
      });
    } else {
      listener({
        type: 'SUBMISSION_PARSING_FAILED',
        platform: this.platform,
        submissionId: context.submissionId,
        reason: result.reason,
        raw: check.raw,
      });
    }
  }
}

/** Wires the adapter to the real page: window messages, GraphQL lookups and console logging. */
export function createLeetCodeAdapter(): LeetCodeAdapter {
  const logger = createLogger('leetcode');
  const pageFetch: typeof fetch = (...args) => fetch(...args);
  return new LeetCodeAdapter({
    logger,
    now: () => new Date(),
    lookupProblem: (slug) =>
      lookupProblem(slug, {
        fetch: pageFetch,
        readNextData: () => document.getElementById('__NEXT_DATA__')?.textContent ?? undefined,
      }),
    fetchSubmissionDetails: (id) => fetchSubmissionDetails(id, { fetch: pageFetch }),
    history: {
      fetchPage: (offset, lastKey) =>
        fetchHistoryPage(offset, lastKey, { fetch: pageFetch, timeoutMs: 15_000 }),
      fetchDetails: (id) => fetchSubmissionRecord(id, { fetch: pageFetch, timeoutMs: 15_000 }),
      sleep: (ms) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms);
        }),
    },
    subscribe: (handler) => subscribeToBridge(LEETCODE_CHANNEL, handler),
  });
}
