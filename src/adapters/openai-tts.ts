import OpenAI, { APIError } from 'openai';
import type { TtsPort } from '../ports/tts-port';
import { ok, err, tryCatch, andThen } from '../shared/result';
import { appError, describeCause } from '../domain/errors';

// maxRetries: 0 is critical - voxmixture owns retry; the SDK otherwise silently retries
// 429s twice, which breaks both our backoff and simulator fault tests.
export const createOpenAiTts = (apiKey: string, baseURL: string): TtsPort => {
  const client = new OpenAI({ apiKey, baseURL, maxRetries: 0 });
  return {
    synthesize: async (request) => {
      if (request.provider !== 'openai') {
        return err(appError('tts', 'openai adapter received a non-openai request'));
      }
      const result = await tryCatch(
        () => client.audio.speech.create({
          model: request.model,
          voice: request.voice,
          input: request.text,
          response_format: 'mp3',
        }),
        (cause) => appError('tts', `OpenAI TTS failed: ${describeCause(cause)}`, {
          cause,
          retryable: cause instanceof APIError
            ? cause.status === 429 || (cause.status ?? 0) >= 500
            : true, // non-APIError = network-level -> retryable
        }),
      );
      if (!result.ok) return result;
      const bytes = await tryCatch(
        async () => new Uint8Array(await result.data.arrayBuffer()),
        (cause) => appError('tts', `OpenAI response read failed: ${describeCause(cause)}`, { cause, retryable: true }),
      );
      return andThen(bytes, (b) => ok({ bytes: b, contentType: 'audio/mpeg' }));
    },
  };
};
