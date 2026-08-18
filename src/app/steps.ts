import * as R from 'remeda';
import { ok, err, all, type Result } from '../shared/result';
import { appError } from '../domain/errors';
import { parseDialogue, type Dialogue } from '../domain/dialogue';
import { buildCast, type CastMember } from '../domain/characters';
import { buildTtsRequest } from '../domain/tts';
import { planEpisode, type EpisodePlan } from '../domain/audio-plan';
import { DEFAULT_TRUE_PEAK, type EncodeSettings, type LoudnessMetrics } from '../domain/dsp';
import type { AppConfig, Provider } from '../domain/config';
import type { TtsPort } from '../ports/tts-port';
import type { DspPort } from '../ports/dsp-port';
import type { FsPort } from '../ports/fs-port';
import type { Step } from './pipeline';
import { logger } from '../shared/logger';

export type Deps = {
  readonly tts: Record<Provider, TtsPort>;
  readonly dsp: DspPort;
  readonly fs: FsPort;
  readonly config: AppConfig;
  readonly providerOverride?: Provider;
  readonly outputRoot: string;
};

// The shapes that flow through the pipeline - explicit, no context-type tower.
export type JobInput    = { project: string; dialoguePath: string };
export type Parsed      = JobInput & { dialogue: Dialogue; skippedLines: number };
export type Planned     = Parsed & { cast: Record<string, CastMember>; plan: EpisodePlan };
export type Synthesized = Planned;                                  // segments now on disk
export type Balanced    = Synthesized & { speakerLoudness: ReadonlyArray<SpeakerLoudness> };
export type Mastered    = Balanced & { finalPath: string; finalMetrics: LoudnessMetrics };

export type SpeakerLoudness = {
  speaker: string; provider: Provider;
  before: LoudnessMetrics; after: LoudnessMetrics | null;  // null when balancing disabled
};

export const parse = (deps: Deps): Step<JobInput, Parsed> => async (input) => {
  const content = await deps.fs.readText(input.dialoguePath);
  if (!content.ok) return content;
  const dialogue = parseDialogue(content.data);
  if (!dialogue.ok) return dialogue;
  const nonEmpty = content.data.split('\n').filter((l) => l.trim().length > 0).length;
  const skippedLines = nonEmpty - dialogue.data.lines.length;
  if (skippedLines > 0) {
    logger.warn(`${input.project}: skipped ${skippedLines} line(s) that do not match "Speaker: text"`);
  }
  return ok({ ...input, dialogue: dialogue.data, skippedLines });
};

// All validation failures surface HERE, before any TTS call.
export const plan = (deps: Deps): Step<Parsed, Planned> => async (ctx) => {
  const cast = buildCast(ctx.dialogue.speakers, deps.config, deps.providerOverride);
  if (!cast.ok) return cast;
  // buildCast validated every speaker; the non-null assertion cannot miss
  const episode = planEpisode(ctx.project, deps.outputRoot, ctx.dialogue.lines,
    (speaker) => cast.data[speaker.toLowerCase()]!.provider);
  const dir = await deps.fs.ensureDir(episode.segmentsDir);
  if (!dir.ok) return dir;
  return ok({ ...ctx, cast: cast.data, plan: episode });
};

// Promise.all over everything is safe BECAUSE each provider's TtsPort is already wrapped
// in withLimit - the concurrency cap lives at the edge, not in this loop.
export const synthesize = (deps: Deps): Step<Planned, Synthesized> => async (ctx) => {
  const byIndex = R.indexBy(ctx.dialogue.lines, (l) => l.index);
  const results = await Promise.all(
    ctx.plan.segments.map(async (seg): Promise<Result<string>> => {
      const line = byIndex[seg.index];
      if (!line) return err(appError('validation', `No dialogue line for segment ${seg.index}`));
      const member = ctx.cast[seg.speaker.toLowerCase()];
      if (!member) return err(appError('validation', `No cast member for ${seg.speaker}`));
      const request = buildTtsRequest(line, member.character, seg.provider);
      if (!request.ok) return request;
      const audio = await deps.tts[seg.provider].synthesize(request.data);
      if (!audio.ok) return err({ ...audio.error, message: `segment ${seg.index} (${seg.speaker}): ${audio.error.message}` });
      return deps.fs.writeBytes(seg.rawPath, audio.data.bytes);
    }),
  );
  const combined = all(results);   // collects EVERY failure, not just the first
  return combined.ok
    ? ok(ctx)
    : err(appError('tts', `${combined.error.length} of ${results.length} segments failed:\n`
        + combined.error.map((e) => `  - ${e.message}`).join('\n')));
};

const meanMetrics = (ms: ReadonlyArray<LoudnessMetrics>): LoudnessMetrics => ({
  lufs: R.meanBy(ms, (m) => m.lufs) ?? 0,
  truePeak: Math.max(...ms.map((m) => m.truePeak)),
  loudnessRange: R.meanBy(ms, (m) => m.loudnessRange) ?? 0,
});

const aggregateBySpeaker = (rows: ReadonlyArray<SpeakerLoudness>): ReadonlyArray<SpeakerLoudness> => {
  const bySpeaker = R.groupBy(rows, (s) => s.speaker);
  return Object.values(bySpeaker).map((group) => ({
    ...group[0]!,
    before: meanMetrics(group.map((r) => r.before)),
    after: group[0]!.after === null ? null : meanMetrics(group.map((r) => r.after!)),
  }));
};

// Measurement-driven per-segment balancing (the Inga problem): a flat gain would clip her
// -1.2 dBTP peaks, and the imbalance varies per generation, so every segment is analyzed
// and loudnorm-limited to the dialog target before concat. The final master pass then only
// corrects the sum, not the balance.
export const balance = (deps: Deps): Step<Synthesized, Balanced> => async (ctx) => {
  const { output } = deps.config.processing;
  const settings = { targetLufs: output.dialogTargetLufs, maxTruePeak: DEFAULT_TRUE_PEAK };

  const results = await Promise.all(
    ctx.plan.segments.map(async (seg): Promise<Result<SpeakerLoudness>> => {
      const before = await deps.dsp.analyze(seg.rawPath);
      if (!before.ok) return before;

      const member = ctx.cast[seg.speaker.toLowerCase()];
      const gainDb = member?.character.gainDb;

      if (!output.segmentNormalization) {
        // honest skip: still transcode to the WAV intermediate the concat expects,
        // report after: null - never fake metrics
        const t = await deps.dsp.transcodeWav(seg.rawPath, seg.balancedPath);
        return t.ok
          ? ok({ speaker: seg.speaker, provider: seg.provider, before: before.data, after: null })
          : t;
      }

      // gain_db rides in the same ffmpeg pass (loudnorm,volume=XdB) - a taste trim on top
      // of measurement, not the mechanism
      // TODO: clips with extreme crest factor (fixture inga-1: -26.3 LUFS at -1.24 dBTP) are
      // true-peak-constrained and land ~3 LU under the dialog target with any loudnorm-only
      // chain (measured: two-pass, LRA=1, and TP=0 all tested). The deviation warning above
      // catches this by design; closing the gap needs a compressor pre-stage, which changes
      // healthy segments too - a taste call for the owner, not something this function does.
      const norm = await deps.dsp.normalize(seg.rawPath, seg.balancedPath, settings, undefined, gainDb);
      if (!norm.ok) return norm;
      const after = await deps.dsp.analyze(seg.balancedPath);
      return after.ok
        ? ok({ speaker: seg.speaker, provider: seg.provider, before: before.data, after: after.data })
        : after;
    }),
  );

  const combined = all(results);
  if (!combined.ok) {
    return err(appError('dsp', `${combined.error.length} segment(s) failed balancing:\n`
      + combined.error.map((e) => `  - ${e.message}`).join('\n')));
  }

  const speakerLoudness = aggregateBySpeaker(combined.data);
  for (const s of speakerLoudness) {
    // single-pass loudnorm on very short segments can undershoot; warn, do not fail
    if (s.after !== null && Math.abs(s.after.lufs - output.dialogTargetLufs) > 1.5) {
      logger.warn(`${s.speaker}: balanced loudness ${s.after.lufs.toFixed(1)} LUFS is more than 1.5 LU off the ${output.dialogTargetLufs} target`);
    }
  }
  return ok({ ...ctx, speakerLoudness });
};

export const master = (deps: Deps): Step<Balanced, Mastered> => async (ctx) => {
  const { output } = deps.config.processing;
  const ordered = R.sortBy(ctx.plan.segments, (s) => s.index).map((s) => s.balancedPath);
  const mixed = await deps.dsp.concat(ordered, ctx.plan.mixdownPath);
  if (!mixed.ok) return mixed;

  const encode: EncodeSettings = {
    codec: 'libmp3lame',
    bitrate: output.bitrate,
    sampleRate: output.sampleRate,
    channels: 1,
  };
  const final = output.normalization
    ? await deps.dsp.normalize(ctx.plan.mixdownPath, ctx.plan.finalPath,
        { targetLufs: output.targetLufs, maxTruePeak: DEFAULT_TRUE_PEAK }, encode)
    : await deps.dsp.encodeMp3(ctx.plan.mixdownPath, ctx.plan.finalPath, encode);
  if (!final.ok) return final;

  const metrics = await deps.dsp.analyze(ctx.plan.finalPath);
  if (!metrics.ok) return metrics;
  return ok({ ...ctx, finalPath: ctx.plan.finalPath, finalMetrics: metrics.data });
};
