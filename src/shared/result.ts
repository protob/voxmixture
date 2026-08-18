import * as R from 'remeda';
import type { AppError } from '../domain/errors';

export type Result<T, E = AppError> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(data: T): Result<T, never> => ({ ok: true, data });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

// The ONLY place `try` is allowed in the codebase. Adapters call this at genuinely
// throwing edges (fetch, execFile, fs, yaml.parse); domain/app never need it.
export const tryCatch = async <T>(
  fn: () => Promise<T>,
  onError: (cause: unknown) => AppError,
): Promise<Result<T>> => {
  try {
    return ok(await fn());
  } catch (cause) {
    return err(onError(cause));
  }
};

// Sync sibling of tryCatch, for genuinely throwing sync edges (JSON.parse, yaml.parse).
export const tryCatchSync = <T>(
  fn: () => T,
  onError: (cause: unknown) => AppError,
): Result<T> => {
  try {
    return ok(fn());
  } catch (cause) {
    return err(onError(cause));
  }
};

export const map = <T, U, E>(r: Result<T, E>, fn: (data: T) => U): Result<U, E> =>
  r.ok ? ok(fn(r.data)) : r;

export const andThen = <T, U, E>(
  r: Result<T, E>,
  fn: (data: T) => Result<U, E>,
): Result<U, E> => (r.ok ? fn(r.data) : r);

export const unwrapOr = <T, E>(r: Result<T, E>, fallback: T): T =>
  r.ok ? r.data : fallback;

// All-or-nothing over an array; collects EVERY error, not just the first.
export const all = <T, E>(results: ReadonlyArray<Result<T, E>>): Result<T[], E[]> => {
  const [failures, successes] = R.partition(results, (r) => !r.ok);
  return failures.length > 0
    ? err(failures.map((r) => (r as { ok: false; error: E }).error))
    : ok(successes.map((r) => (r as { ok: true; data: T }).data));
};
