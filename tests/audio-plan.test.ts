import { describe, expect, it } from 'vitest';
import { planEpisode, sanitizeName } from '../src/domain/audio-plan';
import type { DialogueLine } from '../src/domain/dialogue';

describe('sanitizeName', () => {
  it('produces a filesystem-safe token with no leading or trailing underscores', () => {
    expect(sanitizeName('Frau Müller-Lüdenscheidt!')).toBe('frau_m_ller_l_denscheidt');
  });

  it('caps length at 60 characters', () => {
    expect(sanitizeName('x'.repeat(100))).toHaveLength(60);
  });
});

describe('planEpisode', () => {
  const lines: ReadonlyArray<DialogueLine> = [
    { index: 0, speaker: 'Konrad', text: 'a' },
    { index: 1, speaker: 'Inga', text: 'b' },
    { index: 2, speaker: 'Konrad', text: 'c' },
  ];

  it('builds ordered, zero-padded segment paths and consults providerFor per speaker', () => {
    const plan = planEpisode('demo', 'output', lines,
      (speaker) => (speaker === 'Inga' ? 'elevenlabs' : 'openai'));
    expect(plan.segments.map((s) => s.rawPath)).toEqual([
      'output/demo/segments/000_konrad.mp3',
      'output/demo/segments/001_inga.mp3',
      'output/demo/segments/002_konrad.mp3',
    ]);
    expect(plan.segments.map((s) => s.balancedPath)).toEqual([
      'output/demo/segments/000_konrad.norm.wav',
      'output/demo/segments/001_inga.norm.wav',
      'output/demo/segments/002_konrad.norm.wav',
    ]);
    expect(plan.segments.map((s) => s.provider)).toEqual(['openai', 'elevenlabs', 'openai']);
  });

  it('places mixdown and final paths under output/<project>/', () => {
    const plan = planEpisode('demo', 'output', lines, () => 'openai');
    expect(plan.outputDir).toBe('output/demo');
    expect(plan.mixdownPath).toBe('output/demo/demo_raw.wav');
    expect(plan.finalPath).toBe('output/demo/demo.mp3');
  });
});
