import * as R from 'remeda';
import { ok, err, type Result } from '../shared/result';
import { appError } from './errors';

export type DialogueLine = {
  readonly index: number;      // position among VALID lines, 0-based - used for segment order
  readonly speaker: string;    // as written in the file (original casing)
  readonly text: string;
};

export type Dialogue = {
  readonly lines: ReadonlyArray<DialogueLine>;
  readonly speakers: ReadonlyArray<string>;  // unique, original casing, in order of appearance
};

const parseLine = (raw: string): { speaker: string; text: string } | null => {
  const colon = raw.indexOf(':');
  if (colon <= 0) return null;
  const speaker = raw.slice(0, colon).trim();
  const text = raw.slice(colon + 1).trim();
  return speaker.length > 0 && text.length > 0 ? { speaker, text } : null;
};

export const parseDialogue = (content: string): Result<Dialogue> => {
  const lines = R.pipe(
    content.split('\n'),
    R.map(parseLine),
    R.filter(R.isNonNull),
    R.map((line, index) => ({ ...line, index })), // index over SURVIVORS, explicit
  );
  if (lines.length === 0) {
    return err(appError('validation', 'No dialogue lines found (expected "Speaker: text" lines)'));
  }
  return ok({ lines, speakers: R.unique(lines.map((l) => l.speaker)) });
};

// Every speaker in the dialogue must be a configured character (matched case-insensitively by name).
export const findUnknownSpeakers = (
  speakers: ReadonlyArray<string>,
  characterNames: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const known = new Set(characterNames.map((n) => n.toLowerCase()));
  return speakers.filter((s) => !known.has(s.toLowerCase()));
};
