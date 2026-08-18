import { describe, expect, it, vi } from 'vitest';
import { withLimit, withRetry } from '../src/adapters/decorators';
import { ok, err, type Result } from '../src/shared/result';
import { appError } from '../src/domain/errors';
import type { AudioBytes, TtsPort } from '../src/ports/tts-port';
import type { TtsRequest } from '../src/domain/tts';

const REQUEST: TtsRequest = { provider: 'openai', text: 'x', voice: 'onyx', model: 'tts-1' };

const AUDIO: AudioBytes = { bytes: new Uint8Array([1, 2, 3]), contentType: 'audio/mpeg' };

// fake port returning a scripted sequence of results, counting calls
const scripted = (results: ReadonlyArray<Result<AudioBytes>>): { port: TtsPort; calls: () => number } => {
  let n = 0;
  return {
    port: { synthesize: async () => results[Math.min(n++, results.length - 1)]! },
    calls: () => n,
  };
};

describe('withRetry', () => {
  it('retries a retryable error up to N tries and returns the last failure', async () => {
    vi.useFakeTimers();
    const { port, calls } = scripted([err(appError('tts', 'rate limited', { retryable: true }))]);
    const promise = withRetry(port, 3).synthesize(REQUEST);
    await vi.runAllTimersAsync();
    const result = await promise;
    vi.useRealTimers();
    expect(result.ok).toBe(false);
    expect(calls()).toBe(3);
  });

  it('does not retry a non-retryable error: exactly one attempt', async () => {
    const { port, calls } = scripted([err(appError('tts', 'invalid key', { retryable: false }))]);
    const result = await withRetry(port, 3).synthesize(REQUEST);
    expect(result.ok).toBe(false);
    expect(calls()).toBe(1);
  });

  it('succeeds after two retryable failures', async () => {
    vi.useFakeTimers();
    const { port, calls } = scripted([
      err(appError('tts', 'rate limited', { retryable: true })),
      err(appError('tts', 'rate limited', { retryable: true })),
      ok(AUDIO),
    ]);
    const promise = withRetry(port, 3).synthesize(REQUEST);
    await vi.runAllTimersAsync();
    const result = await promise;
    vi.useRealTimers();
    expect(result.ok).toBe(true);
    expect(calls()).toBe(3);
  });
});

describe('withLimit', () => {
  it('never exceeds the concurrency cap with more pending calls than slots', async () => {
    let inFlight = 0;
    let peak = 0;
    const slow: TtsPort = {
      synthesize: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight -= 1;
        return ok(AUDIO);
      },
    };
    const limited = withLimit(slow, 2);
    const results = await Promise.all(Array.from({ length: 5 }, () => limited.synthesize(REQUEST)));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(peak).toBe(2);
  });
});
