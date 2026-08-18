import type { Result } from '../shared/result';
import type { TtsRequest } from '../domain/tts';

export type AudioBytes = { readonly bytes: Uint8Array; readonly contentType: string };

export type TtsPort = {
  readonly synthesize: (request: TtsRequest) => Promise<Result<AudioBytes>>;
};
