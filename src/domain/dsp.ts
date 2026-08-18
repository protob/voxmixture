export type LoudnessMetrics = {
  readonly lufs: number;           // loudnorm input_i
  readonly truePeak: number;       // loudnorm input_tp (dBTP)
  readonly loudnessRange: number;  // loudnorm input_lra (LU)
};
// NOTE: no duration, no rmsLevel - loudnorm does not report them.

export type NormalizeSettings = {
  readonly targetLufs: number;
  readonly maxTruePeak: number;    // default -1.5
};

export type EncodeSettings = {
  readonly codec: 'libmp3lame';
  readonly bitrate: string;        // '192k'
  readonly sampleRate: number;     // 44100
  readonly channels: number;       // 1 (TTS output is mono; joins fine)
};

export const DEFAULT_TRUE_PEAK = -1.5;
