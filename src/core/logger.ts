export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

export type LogSink = (
  level: LogLevel,
  prefix: string,
  message: string,
  context?: LogContext,
) => void;

const consoleSink: LogSink = (level, prefix, message, context) => {
  const args: unknown[] = [prefix, message];
  if (context !== undefined) {
    args.push(context);
  }
  console[level](...args);
};

export function formatPrefix(scope?: string): string {
  return scope ? `[CodeJournal:${scope}]` : '[CodeJournal]';
}

/**
 * Creates a logger whose output is prefixed with `[CodeJournal]` or `[CodeJournal:<scope>]`.
 * Callers must never pass secrets (e.g. tokens) in messages or context.
 */
export function createLogger(scope?: string, sink: LogSink = consoleSink): Logger {
  const prefix = formatPrefix(scope);
  const log =
    (level: LogLevel) =>
    (message: string, context?: LogContext): void => {
      sink(level, prefix, message, context);
    };

  return {
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
  };
}
