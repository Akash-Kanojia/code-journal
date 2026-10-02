import { describe, expect, it, vi } from 'vitest';
import { createLogger, formatPrefix, type LogSink } from '../../src/core/logger';

describe('logger', () => {
  it('formats prefixes with and without scope', () => {
    expect(formatPrefix()).toBe('[CodeJournal]');
    expect(formatPrefix('LeetCode')).toBe('[CodeJournal:LeetCode]');
  });

  it('forwards level, prefix, message and context to the sink', () => {
    const sink = vi.fn<LogSink>();
    const logger = createLogger('GitHub', sink);

    logger.error('Sync failed', { attempt: 2 });
    logger.info('Done');

    expect(sink).toHaveBeenNthCalledWith(1, 'error', '[CodeJournal:GitHub]', 'Sync failed', {
      attempt: 2,
    });
    expect(sink).toHaveBeenNthCalledWith(2, 'info', '[CodeJournal:GitHub]', 'Done', undefined);
  });
});
