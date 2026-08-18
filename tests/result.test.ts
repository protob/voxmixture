import { describe, expect, it } from 'vitest';
import { all, andThen, err, map, ok, tryCatch, tryCatchSync, unwrapOr } from '../src/shared/result';
import { appError } from '../src/domain/errors';

describe('all', () => {
  it('collects every error, not just the first', () => {
    const result = all([ok(1), err(appError('io', 'x')), err(appError('tts', 'y'))]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toHaveLength(2);
    expect(result.error.map((e) => e.message)).toEqual(['x', 'y']);
  });

  it('returns all data when everything succeeds', () => {
    const result = all([ok(1), ok(2), ok(3)]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([1, 2, 3]);
  });
});

describe('map and andThen', () => {
  it('map transforms data and passes errors through unchanged', () => {
    expect(map(ok(2), (n) => n * 2)).toEqual(ok(4));
    const failure = err(appError('io', 'nope'));
    expect(map(failure, (n: number) => n * 2)).toBe(failure);
  });

  it('andThen chains and short-circuits on the first error', () => {
    const result = andThen(ok(2), (n) => (n > 1 ? ok(n * 10) : err(appError('validation', 'too small'))));
    expect(result).toEqual(ok(20));
    const failure = err(appError('io', 'nope'));
    expect(andThen(failure, (n: number) => ok(n))).toBe(failure);
  });
});

describe('unwrapOr', () => {
  it('returns data on ok and the fallback on error', () => {
    expect(unwrapOr(ok(5), 0)).toBe(5);
    expect(unwrapOr(err(appError('io', 'x')), 0)).toBe(0);
  });
});

describe('tryCatch', () => {
  it('catches a thrown error and maps it through onError', async () => {
    const result = await tryCatch(
      () => Promise.reject(new Error('boom')),
      (cause) => appError('io', `caught: ${cause instanceof Error ? cause.message : 'unknown'}`),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe('caught: boom');
  });

  it('returns ok for a resolving function', async () => {
    expect(await tryCatch(() => Promise.resolve(42), () => appError('io', 'x'))).toEqual(ok(42));
  });
});

describe('tryCatchSync', () => {
  it('catches a synchronous throw and maps it through onError', () => {
    const result = tryCatchSync(
      () => JSON.parse('not json'),
      () => appError('dsp', 'bad json'),
    );
    expect(result.ok).toBe(false);
  });
});
