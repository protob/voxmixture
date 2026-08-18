import { describe, expect, it } from 'vitest';
import { buildCast, resolveProvider } from '../src/domain/characters';
import { planEpisode } from '../src/domain/audio-plan';
import { parseDialogue } from '../src/domain/dialogue';
import type { AppConfig, CharacterConfig } from '../src/domain/config';

const konrad: CharacterConfig = {
  id: 'konrad',
  name: 'Konrad',
  provider: 'openai',
  voices: { openai: { voiceId: 'onyx', model: 'tts-1' } },
};

const inga: CharacterConfig = {
  id: 'inga',
  name: 'Inga',
  provider: 'elevenlabs',
  voices: {
    elevenlabs: {
      voiceId: 'rGo0C9ZSs6Oklg31XCSB',
      settings: { stability: 0.7, similarityBoost: 0.75, style: 0, useSpeakerBoost: true },
    },
  },
};

const config = (characters: ReadonlyArray<CharacterConfig>): AppConfig => ({
  characters,
  processing: {
    output: {
      format: 'mp3', bitrate: '192k', sampleRate: 44100, normalization: true,
      targetLufs: -16, segmentNormalization: true, dialogTargetLufs: -18,
    },
    defaultProvider: 'openai',
  },
});

describe('resolveProvider', () => {
  const noProvider: CharacterConfig = { id: 'x', name: 'X', voices: {} };

  it('uses the global default when neither cli override nor character provider is set', () => {
    expect(resolveProvider(noProvider, 'openai')).toBe('openai');
  });

  it('prefers the character provider over the global default', () => {
    expect(resolveProvider(inga, 'openai')).toBe('elevenlabs');
  });

  it('prefers the cli override over the global default', () => {
    expect(resolveProvider(noProvider, 'openai', 'elevenlabs')).toBe('elevenlabs');
  });

  it('prefers the cli override over the character provider', () => {
    expect(resolveProvider(inga, 'openai', 'openai')).toBe('openai');
  });
});

describe('buildCast', () => {
  it('reports an unknown speaker by name', () => {
    const result = buildCast(['Ghost'], config([konrad]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('Ghost');
  });

  it('reports a character whose resolved provider has no voice settings', () => {
    const result = buildCast(['Inga'], config([inga]), 'openai');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('no openai voice settings');
  });

  it('collects multiple problems together instead of stopping at the first', () => {
    const result = buildCast(['Ghost', 'Phantom'], config([konrad]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('Ghost');
    expect(result.error.message).toContain('Phantom');
  });

  it('matches speakers case-insensitively (KONRAD matches Konrad)', () => {
    const result = buildCast(['KONRAD'], config([konrad]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data['konrad']?.character.name).toBe('Konrad');
  });

  it('B3 regression: non-alternating turns keep each speaker pinned to their own provider', () => {
    const dialogue = parseDialogue('Konrad: a\nKonrad: b\nInga: c\nKonrad: d');
    expect(dialogue.ok).toBe(true);
    if (!dialogue.ok) return;

    const cast = buildCast(dialogue.data.speakers, config([konrad, inga]));
    expect(cast.ok).toBe(true);
    if (!cast.ok) return;

    const plan = planEpisode('test', 'output', dialogue.data.lines,
      (speaker) => cast.data[speaker.toLowerCase()]!.provider);
    expect(plan.segments.map((s) => s.provider)).toEqual(['openai', 'openai', 'elevenlabs', 'openai']);
  });
});
