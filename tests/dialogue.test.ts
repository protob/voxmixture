import { describe, expect, it } from 'vitest';
import { findUnknownSpeakers, parseDialogue } from '../src/domain/dialogue';

const SAMPLE = `Konrad: Hallo, dies ist ein Test des Audio-Generierungssystems.
Inga: Es ist großartig zu sehen, dass es mit mehreren Sprechern und Stimmen funktioniert.
Konrad: Das System ordnet jeden Sprecher der entsprechenden Stimme aus der Konfigurationsdatei zu.
Inga: Und es unterstützt sowohl OpenAI als auch ElevenLabs Stimmen, oder sogar eine Mischung beider Anbieter.
Konrad: Dies ist alles Teil unserer vereinfachten Audio-Verarbeitungs-Pipeline.`;

describe('parseDialogue', () => {
  it('parses the committed sample file content: 5 lines, speakers Konrad and Inga, indices 0..4', () => {
    const result = parseDialogue(SAMPLE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.lines).toHaveLength(5);
    expect(result.data.speakers).toEqual(['Konrad', 'Inga']);
    expect(result.data.lines.map((l) => l.index)).toEqual([0, 1, 2, 3, 4]);
  });

  it('skips no-colon lines, empty speaker, empty text and blank lines; index counts survivors without gaps', () => {
    const content = [
      'garbage without a colon',
      'Konrad: first valid',
      ': text with empty speaker',
      'Name:',
      '',
      '   ',
      'Inga: second valid',
    ].join('\n');
    const result = parseDialogue(content);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.lines).toHaveLength(2);
    expect(result.data.lines.map((l) => l.index)).toEqual([0, 1]);
    expect(result.data.lines.map((l) => l.speaker)).toEqual(['Konrad', 'Inga']);
  });

  it('parses 3+ speakers with arbitrary turn order (nothing assumes two speakers or alternation)', () => {
    const content = [
      'Host: welcome',
      'Host: today we have two guests',
      'GuestA: hello',
      'GuestB: hi there',
      'GuestA: good to be here',
      'Host: let us start',
    ].join('\n');
    const result = parseDialogue(content);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.speakers).toEqual(['Host', 'GuestA', 'GuestB']);
    expect(result.data.lines).toHaveLength(6);
  });

  it('returns a validation error for all-garbage input', () => {
    const result = parseDialogue('no colons here\njust noise\n\n');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('validation');
  });
});

describe('findUnknownSpeakers', () => {
  it('matches case-insensitively and reports only unknown names', () => {
    expect(findUnknownSpeakers(['KONRAD', 'Inga', 'Ghost'], ['Konrad', 'Inga'])).toEqual(['Ghost']);
  });
});
