import type { Result } from '../shared/result';
import type { EncodeSettings, LoudnessMetrics, NormalizeSettings } from '../domain/dsp';

export type DspPort = {
  // concat inputs in order into one WAV file
  readonly concat: (inputPaths: ReadonlyArray<string>, outputPath: string) => Promise<Result<string>>;
  // loudnorm to target; output format decided by outputPath extension + encode arg
  readonly normalize: (
    inputPath: string,
    outputPath: string,
    settings: NormalizeSettings,
    encode?: EncodeSettings,      // present -> encode (final mp3); absent -> WAV intermediate
    gainDb?: number,              // optional trim applied after loudnorm
  ) => Promise<Result<string>>;
  // plain WAV transcode, no loudnorm - the balancing-disabled path (never fake metrics)
  readonly transcodeWav: (inputPath: string, outputPath: string) => Promise<Result<string>>;
  // plain mp3 encode, no loudnorm - the final pass when episode normalization is off
  readonly encodeMp3: (inputPath: string, outputPath: string, encode: EncodeSettings) => Promise<Result<string>>;
  readonly analyze: (path: string) => Promise<Result<LoudnessMetrics>>;
  // startup preflight - is ffmpeg on PATH?
  readonly available: () => Promise<Result<string>>;
};
