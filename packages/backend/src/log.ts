/**
 * Error-only logging (Requirement 3.6). The logger can only be handed numbers and booleans as context
 * and a short event name, plus the *name* of an error: never a message (a `JSON.parse` message quotes the
 * input), a payload, a token, a title or a login. Users are referred to by numeric id.
 */

export type LogContext = Readonly<Record<string, number | boolean>>;

export interface Logger {
  error(event: string, context?: LogContext, error?: unknown): void;
}

function describeError(error: unknown): Record<string, number | string> {
  if (!(error instanceof Error)) {
    return { errorName: 'UnknownError' };
  }
  const described: Record<string, number | string> = { errorName: error.name };
  const metadata = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata;
  if (typeof metadata?.httpStatusCode === 'number') {
    described.httpStatus = metadata.httpStatusCode;
  }
  return described;
}

/** Writes one JSON line to stderr, which CloudWatch captures. */
export function createLogger(write: (line: string) => void = console.error): Logger {
  return {
    error(event, context = {}, error) {
      write(JSON.stringify({ level: 'error', event, ...context, ...describeError(error) }));
    },
  };
}

export const silentLogger: Logger = { error() {} };
