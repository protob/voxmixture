import type { TtsPort } from '../ports/tts-port';
import { err, tryCatch } from '../shared/result';
import { appError, describeCause } from '../domain/errors';

export const createElevenLabsTts = (apiKey: string, baseUrl: string): TtsPort => ({
  synthesize: async (request) => {
    if (request.provider !== 'elevenlabs') {
      return err(appError('tts', 'elevenlabs adapter received a non-elevenlabs request'));
    }
    const response = await tryCatch(
      () => fetch(`${baseUrl}/text-to-speech/${request.voiceId}`, {
        method: 'POST',
        headers: {
          Accept: 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text: request.text,
          model_id: request.modelId,
          voice_settings: {
            stability: request.settings.stability,
            similarity_boost: request.settings.similarityBoost,
            style: request.settings.style,
            use_speaker_boost: request.settings.useSpeakerBoost,
          },
        }),
      }),
      (cause) => appError('tts', `ElevenLabs request failed: ${describeCause(cause)}`, { cause, retryable: true }),
    );
    if (!response.ok) return response;

    const res = response.data;
    if (!res.ok) {
      const body = await res.text().catch(() => '<unreadable body>');
      return err(appError('tts', `ElevenLabs ${res.status} ${res.statusText}: ${body}`, {
        retryable: res.status === 429 || res.status >= 500,
      }));
    }
    return tryCatch(
      async () => ({
        bytes: new Uint8Array(await res.arrayBuffer()),
        contentType: res.headers.get('content-type') ?? 'audio/mpeg',
      }),
      (cause) => appError('tts', `ElevenLabs response read failed: ${describeCause(cause)}`, { cause, retryable: true }),
    );
  },
});
