import { ok, err, type Result } from '../shared/result';
import { appError } from './errors';
import type { CharacterConfig, ElevenLabsVoiceSettings, OpenAIVoice, Provider } from './config';
import type { DialogueLine } from './dialogue';

export type OpenAITtsRequest = {
  readonly provider: 'openai';
  readonly text: string;
  readonly voice: OpenAIVoice;
  readonly model: string;          // 'tts-1'
};

export type ElevenLabsTtsRequest = {
  readonly provider: 'elevenlabs';
  readonly text: string;
  readonly voiceId: string;
  readonly modelId: string;        // 'eleven_multilingual_v2'
  readonly settings: ElevenLabsVoiceSettings;
};

export type TtsRequest = OpenAITtsRequest | ElevenLabsTtsRequest;

export const ELEVENLABS_MODEL = 'eleven_multilingual_v2';

// The no-voice branches are unreachable after buildCast validation - they exist so this
// function is total and independently testable, not as a real error path.
export const buildTtsRequest = (
  line: DialogueLine,
  character: CharacterConfig,
  provider: Provider,
): Result<TtsRequest> => {
  if (provider === 'openai') {
    const voice = character.voices.openai;
    return voice
      ? ok({ provider, text: line.text, voice: voice.voiceId, model: voice.model })
      : err(appError('validation', `Character "${character.name}" has no openai voice`));
  }
  const voice = character.voices.elevenlabs;
  return voice
    ? ok({ provider, text: line.text, voiceId: voice.voiceId, modelId: ELEVENLABS_MODEL, settings: voice.settings })
    : err(appError('validation', `Character "${character.name}" has no elevenlabs voice`));
};
