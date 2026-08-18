import * as R from 'remeda';
import pLimit from 'p-limit';
import type { AudioBytes, TtsPort } from '../ports/tts-port';
import type { Result } from '../shared/result';
import { logger } from '../shared/logger';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const withRetry = (tts: TtsPort, tries = 3): TtsPort => ({
  synthesize: async (request) => {
    let last!: Result<AudioBytes>;
    for (const attempt of R.range(0, tries)) {
      last = await tts.synthesize(request);
      if (last.ok || !last.error.retryable) return last;
      const delay = 2 ** attempt * 500 + Math.random() * 250;
      logger.warn(`retryable TTS failure (attempt ${attempt + 1}/${tries}), backing off ${Math.round(delay)}ms`, { message: last.error.message });
      await sleep(delay);
    }
    return last;
  },
});

// Per-provider concurrency cap. Compose as withLimit(withRetry(port), n) so retries also
// respect the cap.
export const withLimit = (tts: TtsPort, concurrency: number): TtsPort => {
  const limit = pLimit(concurrency);
  return { synthesize: (request) => limit(() => tts.synthesize(request)) };
};
