import * as R from 'remeda';
import { ok, err, type Result } from '../shared/result';
import { appError } from './errors';
import type { AppConfig, CharacterConfig, Provider } from './config';

// Case-insensitive name -> character index. Build ONCE per run, O(1) per line after.
export const indexCharacters = (
  characters: ReadonlyArray<CharacterConfig>,
): Record<string, CharacterConfig> =>
  R.indexBy(characters, (c) => c.name.toLowerCase());

// Per-CHARACTER provider resolution. CLI override > character config > global default.
export const resolveProvider = (
  character: CharacterConfig,
  defaultProvider: Provider,
  cliOverride?: Provider,
): Provider => cliOverride ?? character.provider ?? defaultProvider;

export type CastMember = {
  readonly character: CharacterConfig;
  readonly provider: Provider;
};

// Plan-time validation of the WHOLE cast: every speaker resolves to a character that has
// voice settings for its resolved provider, so we fail before any API call, not on
// segment 17. Collects ALL problems, not just the first.
export const buildCast = (
  speakers: ReadonlyArray<string>,
  config: AppConfig,
  cliOverride?: Provider,
): Result<Record<string, CastMember>> => {
  const byName = indexCharacters(config.characters);
  const problems: string[] = [];
  const cast: Record<string, CastMember> = {};

  for (const speaker of speakers) {
    const character = byName[speaker.toLowerCase()];
    if (!character) {
      problems.push(`Unknown speaker "${speaker}" - no matching character in config.yaml`);
      continue;
    }
    const provider = resolveProvider(character, config.processing.defaultProvider, cliOverride);
    if (!character.voices[provider]) {
      problems.push(`Character "${character.name}" resolved to provider "${provider}" but has no ${provider} voice settings`);
      continue;
    }
    cast[speaker.toLowerCase()] = { character, provider };
  }

  return problems.length > 0
    ? err(appError('validation', problems.join('\n')))
    : ok(cast);
};
