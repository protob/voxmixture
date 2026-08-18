import { describe, expect, it } from 'vitest';
import { buildTtsRequest, ELEVENLABS_MODEL } from '../src/domain/tts';
import type { CharacterConfig } from '../src/domain/config';
import type { DialogueLine } from '../src/domain/dialogue';

const line: DialogueLine = { index: 0, speaker: 'Konrad', text: 'Hallo Welt' };

const character: CharacterConfig = {
  id: 'konrad',
  name: 'Konrad',
  voices: {
    openai: { voiceId: 'onyx', model: 'tts-1' },
    elevenlabs: {
      voiceId: 'OI5E0KTcArkkIzhpC4xj',
      settings: { stability: 0.8, similarityBoost: 0.8, style: 0, useSpeakerBoost: true },
    },
  },
};

describe('buildTtsRequest', () => {
  it('builds the openai union member with the character voice and model tts-1', () => {
    const result = buildTtsRequest(line, character, 'openai');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({ provider: 'openai', text: 'Hallo Welt', voice: 'onyx', model: 'tts-1' });
  });

  it('builds the elevenlabs union member with modelId eleven_multilingual_v2 and the character settings', () => {
    const result = buildTtsRequest(line, character, 'elevenlabs');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({
      provider: 'elevenlabs',
      text: 'Hallo Welt',
      voiceId: 'OI5E0KTcArkkIzhpC4xj',
      modelId: ELEVENLABS_MODEL,
      settings: { stability: 0.8, similarityBoost: 0.8, style: 0, useSpeakerBoost: true },
    });
  });

  it('returns a validation error when the character lacks the requested provider voice', () => {
    const bare: CharacterConfig = { id: 'x', name: 'X', voices: {} };
    const openai = buildTtsRequest(line, bare, 'openai');
    const elevenlabs = buildTtsRequest(line, bare, 'elevenlabs');
    expect(openai.ok).toBe(false);
    expect(elevenlabs.ok).toBe(false);
  });
});
