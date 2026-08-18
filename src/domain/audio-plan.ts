import { join } from 'node:path';
import type { Provider } from './config';
import type { DialogueLine } from './dialogue';

// Filesystem-safe token from a speaker name.
export const sanitizeName = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);

export type SegmentPlan = {
  readonly index: number;
  readonly speaker: string;
  readonly provider: Provider;
  // raw synthesized segment (mp3 straight from the API)
  readonly rawPath: string;
  // loudness-normalized WAV intermediate
  readonly balancedPath: string;
};

export type EpisodePlan = {
  readonly project: string;
  readonly outputDir: string;      // output/<project>
  readonly segmentsDir: string;    // output/<project>/segments
  readonly segments: ReadonlyArray<SegmentPlan>;
  readonly mixdownPath: string;    // output/<project>/<project>_raw.wav
  readonly finalPath: string;      // output/<project>/<project>.mp3
};

// The ONE place output paths and names are built. Intermediates are WAV so audio is only
// lossy-encoded once, in the final master pass.
export const planEpisode = (
  project: string,
  outputRoot: string,
  lines: ReadonlyArray<DialogueLine>,
  providerFor: (speaker: string) => Provider,
): EpisodePlan => {
  const outputDir = join(outputRoot, project);
  const segmentsDir = join(outputDir, 'segments');
  const segments = lines.map((line) => {
    const base = `${String(line.index).padStart(3, '0')}_${sanitizeName(line.speaker)}`;
    return {
      index: line.index,
      speaker: line.speaker,
      provider: providerFor(line.speaker),
      rawPath: join(segmentsDir, `${base}.mp3`),
      balancedPath: join(segmentsDir, `${base}.norm.wav`),
    };
  });
  return {
    project,
    outputDir,
    segmentsDir,
    segments,
    mixdownPath: join(outputDir, `${project}_raw.wav`),
    finalPath: join(outputDir, `${project}.mp3`),
  };
};
