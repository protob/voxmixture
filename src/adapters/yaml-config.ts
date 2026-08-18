import yaml from 'yaml';
import { z } from 'zod';
import * as R from 'remeda';
import type { FsPort } from '../ports/fs-port';
import { ok, err, tryCatchSync, andThen, type Result } from '../shared/result';
import { appError, describeCause } from '../domain/errors';
import type { AppConfig, CharacterConfig } from '../domain/config';

const OPENAI_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const;

const openaiVoiceSchema = z.object({
  voice_id: z.enum(OPENAI_VOICES),
  model: z.string().default('tts-1'),
});

const elevenLabsVoiceSchema = z.object({
  voice_id: z.string(),
  settings: z.object({
    stability: z.number(),
    similarity_boost: z.number(),
    style: z.number(),
    use_speaker_boost: z.boolean(),
  }),
});

const characterSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.enum(['openai', 'elevenlabs']).optional(),
  gain_db: z.number().optional(),
  voices: z.object({
    openai: openaiVoiceSchema.optional(),
    elevenlabs: elevenLabsVoiceSchema.optional(),
  }),
});

const appConfigSchema = z.object({
  characters: z.array(characterSchema),
  processing: z.object({
    output: z.object({
      format: z.literal('mp3'),
      bitrate: z.string(),
      sample_rate: z.number().default(44100),
      normalization: z.boolean(),
      target_lufs: z.number(),
      segment_normalization: z.boolean().default(true),
      dialog_target_lufs: z.number().default(-18),
    }),
    providers: z.object({
      default: z.enum(['openai', 'elevenlabs']),
    }),
  }),
});

// snake_case YAML -> camelCase domain shapes, explicit field by field. Conditional spreads
// keep absent optionals absent (exactOptionalPropertyTypes).
const toCharacter = (char: z.infer<typeof characterSchema>): CharacterConfig => ({
  id: char.id,
  name: char.name,
  ...(char.provider !== undefined ? { provider: char.provider } : {}),
  ...(char.gain_db !== undefined ? { gainDb: char.gain_db } : {}),
  voices: {
    ...(char.voices.openai
      ? { openai: { voiceId: char.voices.openai.voice_id, model: char.voices.openai.model } }
      : {}),
    ...(char.voices.elevenlabs
      ? {
          elevenlabs: {
            voiceId: char.voices.elevenlabs.voice_id,
            settings: {
              stability: char.voices.elevenlabs.settings.stability,
              similarityBoost: char.voices.elevenlabs.settings.similarity_boost,
              style: char.voices.elevenlabs.settings.style,
              useSpeakerBoost: char.voices.elevenlabs.settings.use_speaker_boost,
            },
          },
        }
      : {}),
  },
});

const validate = (data: unknown): Result<z.infer<typeof appConfigSchema>> => {
  const result = appConfigSchema.safeParse(data);
  return result.success
    ? ok(result.data)
    : err(appError('config', R.pipe(
        result.error.issues,
        R.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
        R.join('\n'),
      )));
};

export const loadConfig = async (fs: FsPort, path: string): Promise<Result<AppConfig>> => {
  const content = await fs.readText(path);
  if (!content.ok) {
    return err(appError('config', `Could not read config at ${path}: ${content.error.message}`, { cause: content.error.cause }));
  }
  const parsed = tryCatchSync(
    () => yaml.parse(content.data) as unknown,
    (cause) => appError('config', `Invalid YAML in ${path}: ${describeCause(cause)}`, { cause }),
  );
  return andThen(andThen(parsed, validate), (raw) => {
    const { output, providers } = raw.processing;
    return ok({
      characters: raw.characters.map(toCharacter),
      processing: {
        output: {
          format: output.format,
          bitrate: output.bitrate,
          sampleRate: output.sample_rate,
          normalization: output.normalization,
          targetLufs: output.target_lufs,
          segmentNormalization: output.segment_normalization,
          dialogTargetLufs: output.dialog_target_lufs,
        },
        defaultProvider: providers.default,
      },
    });
  });
};
