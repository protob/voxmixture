export type ErrorKind = 'config' | 'validation' | 'io' | 'tts' | 'dsp';

export type AppError = {
  readonly kind: ErrorKind;
  readonly message: string;
  // set by adapters: 429 / 5xx / network -> true. Drives withRetry.
  readonly retryable?: boolean;
  // original thrown value, printed only with --verbose
  readonly cause?: unknown;
};

export const appError = (
  kind: ErrorKind,
  message: string,
  extra?: Partial<Pick<AppError, 'retryable' | 'cause'>>,
): AppError => ({ kind, message, ...extra });

// Safe stringification of an unknown thrown value. The ONLY place this dance lives.
export const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
