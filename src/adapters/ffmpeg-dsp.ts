import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DspPort } from '../ports/dsp-port';
import { ok, err, tryCatch, tryCatchSync, andThen, type Result } from '../shared/result';
import { appError, describeCause } from '../domain/errors';
import type { LoudnessMetrics } from '../domain/dsp';
import { logger } from '../shared/logger';

const run = promisify(execFile);

// Everything goes through execFile with args arrays - no shell, no string-built commands.
const ffmpeg = (args: ReadonlyArray<string>) => {
  logger.debug('ffmpeg', { args });
  return tryCatch(
    () => run('ffmpeg', ['-hide_banner', '-nostats', ...args], { maxBuffer: 64 * 1024 * 1024 }),
    (cause) => appError('dsp', `ffmpeg failed: ${describeCause(cause)}`, { cause }),
  );
};

const parseJson = (text: string): Result<unknown> =>
  tryCatchSync(
    () => JSON.parse(text) as unknown,
    (cause) => appError('dsp', `loudnorm JSON unparseable: ${describeCause(cause)}`, { cause }),
  );

// loudnorm prints its JSON block last on stderr; take the LAST {...} span.
// lufs comes from input_i - there is no input_lufs key and loudnorm reports no duration.
export const parseLoudnorm = (stderr: string): Result<LoudnessMetrics> => {
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start === -1 || end <= start) return err(appError('dsp', 'No loudnorm JSON found in ffmpeg output'));
  return andThen(parseJson(stderr.slice(start, end + 1)), (raw) => {
    const m = raw as Record<string, unknown>;
    const num = (key: string): number | null => {
      const v = m[key];
      const n = typeof v === 'string' ? Number.parseFloat(v) : typeof v === 'number' ? v : Number.NaN;
      return Number.isFinite(n) ? n : null;
    };
    const lufs = num('input_i');
    const truePeak = num('input_tp');
    const loudnessRange = num('input_lra');
    return lufs === null || truePeak === null || loudnessRange === null
      ? err(appError('dsp', `loudnorm JSON missing expected keys (got: ${Object.keys(m).join(', ')})`))
      : ok({ lufs, truePeak, loudnessRange });
  });
};

export const createFfmpegDsp = (): DspPort => ({
  available: async () => {
    const r = await ffmpeg(['-version']);
    return r.ok ? ok(r.data.stdout.split('\n')[0] ?? 'ffmpeg') : r;
  },

  concat: async (inputPaths, outputPath) => {
    const filter = inputPaths.map((_, i) => `[${i}:a]`).join('')
      + `concat=n=${inputPaths.length}:v=0:a=1[out]`;
    const args = [
      '-y',
      ...inputPaths.flatMap((p) => ['-i', p]),
      '-filter_complex', filter,
      '-map', '[out]',
      '-c:a', 'pcm_s16le',           // WAV intermediate - encode once, at the end
      outputPath,
    ];
    const r = await ffmpeg(args);
    return r.ok ? ok(outputPath) : r;
  },

  normalize: async (inputPath, outputPath, settings, encode, gainDb) => {
    const loudnorm = `loudnorm=I=${settings.targetLufs}:TP=${settings.maxTruePeak}`;
    const filter = gainDb !== undefined && gainDb !== 0
      ? `${loudnorm},volume=${gainDb}dB`
      : loudnorm;
    const encodeArgs = encode
      ? ['-ar', String(encode.sampleRate), '-ac', String(encode.channels), '-c:a', encode.codec, '-b:a', encode.bitrate]
      : ['-ar', '44100', '-c:a', 'pcm_s16le'];   // loudnorm upsamples to 192k internally - pin the rate
    const r = await ffmpeg(['-y', '-i', inputPath, '-af', filter, ...encodeArgs, outputPath]);
    return r.ok ? ok(outputPath) : r;
  },

  transcodeWav: async (inputPath, outputPath) => {
    const r = await ffmpeg(['-y', '-i', inputPath, '-ar', '44100', '-c:a', 'pcm_s16le', outputPath]);
    return r.ok ? ok(outputPath) : r;
  },

  encodeMp3: async (inputPath, outputPath, encode) => {
    const r = await ffmpeg(['-y', '-i', inputPath, '-ar', String(encode.sampleRate), '-ac', String(encode.channels), '-c:a', encode.codec, '-b:a', encode.bitrate, outputPath]);
    return r.ok ? ok(outputPath) : r;
  },

  analyze: async (path) => {
    const r = await ffmpeg(['-i', path, '-af', 'loudnorm=print_format=json', '-f', 'null', '-']);
    return r.ok ? parseLoudnorm(r.data.stderr) : r;
  },
});
