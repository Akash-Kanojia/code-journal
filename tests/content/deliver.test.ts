import { describe, expect, it, vi } from 'vitest';
import { createLogger, type LogSink } from '../../src/core/logger';
import { deliverSubmission, type SendMessage } from '../../src/content/deliver';
import { leetCodeSubmission } from '../helpers/submissions';

const noSleep = () => Promise.resolve();

describe('deliverSubmission', () => {
  it('sends the submission and returns the acknowledgement', async () => {
    const send = vi.fn<SendMessage>(() =>
      Promise.resolve({ ok: true, data: { created: true, key: 'k' } }),
    );
    const submission = leetCodeSubmission();
    expect(
      await deliverSubmission(
        submission,
        send,
        createLogger('t', () => undefined),
        noSleep,
      ),
    ).toEqual({
      created: true,
      key: 'k',
    });
    expect(send).toHaveBeenCalledWith({ type: 'SUBMISSION_CAPTURED', submission });
  });

  it('retries while the worker is unavailable', async () => {
    const send = vi
      .fn<SendMessage>()
      .mockRejectedValueOnce(
        new Error('Could not establish connection. Receiving end does not exist.'),
      )
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ ok: true, data: { created: false, key: 'k' } });
    expect(
      await deliverSubmission(
        leetCodeSubmission(),
        send,
        createLogger('t', () => undefined),
        noSleep,
      ),
    ).toEqual({
      created: false,
      key: 'k',
    });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('gives up after a few attempts and logs without the code', async () => {
    const sink = vi.fn<LogSink>();
    const send = vi.fn<SendMessage>(() =>
      Promise.resolve({ ok: false, error: 'IndexedDB unavailable' }),
    );
    const submission = leetCodeSubmission({ code: 'SECRET_CODE' });
    expect(
      await deliverSubmission(submission, send, createLogger('t', sink), noSleep),
    ).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(sink.mock.calls)).not.toContain('SECRET_CODE');
  });

  it('stops immediately when the extension was reloaded', async () => {
    const send = vi.fn<SendMessage>(() =>
      Promise.reject(new Error('Extension context invalidated.')),
    );
    expect(
      await deliverSubmission(
        leetCodeSubmission(),
        send,
        createLogger('t', () => undefined),
        noSleep,
      ),
    ).toBeUndefined();
    expect(send).toHaveBeenCalledOnce();
  });
});
