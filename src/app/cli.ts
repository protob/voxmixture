#!/usr/bin/env bun
// Composition root: the only file that reads env, constructs adapters, and calls
// process.exit.
import { parseArgs } from 'node:util';
import { join } from 'node:path';
import chalk from 'chalk';
import * as R from 'remeda';
import { tryCatch, tryCatchSync } from '../shared/result';
import { appError, describeCause, type AppError, type ErrorKind } from '../domain/errors';
import { resolveProvider } from '../domain/characters';
import type { Provider } from '../domain/config';
import type { TtsPort } from '../ports/tts-port';
import { createBunFs } from '../adapters/bun-fs';
import { createFfmpegDsp } from '../adapters/ffmpeg-dsp';
import { createOpenAiTts } from '../adapters/openai-tts';
import { createElevenLabsTts } from '../adapters/elevenlabs-tts';
import { withLimit, withRetry } from '../adapters/decorators';
import { loadConfig } from '../adapters/yaml-config';
import { loadApiKey } from '../adapters/api-keys';
import { pipeline } from './pipeline';
import { parse, plan, synthesize, balance, master, type Deps, type Mastered } from './steps';
import { logger } from '../shared/logger';

const USAGE = `voxmixture - dialogue scripts to TTS to one loudness-balanced episode

  --project <name>     process only input/<name> (default: every dir under --input)
  --input <dir>        projects root (default: input)
  --config <path>      config file (default: config.yaml)
  --provider <p>       openai | elevenlabs - force EVERY character to one provider
  --sim                use the local TTS simulator for both providers (no API keys needed)
  --sim-url <url>      simulator base URL (default: env SIM_BASE_URL or http://localhost:4880/v1)
  --verbose            debug logging (same as LOG_LEVEL=debug) + print error causes
  --help
`;

const SIM_DEFAULT = 'http://localhost:4880/v1';

const KIND_EXIT: Record<ErrorKind, number> = { config: 2, validation: 3, io: 4, tts: 5, dsp: 6 };

const resolveBaseUrls = (args: { sim: boolean; simUrl?: string }) => {
  const simUrl = args.simUrl ?? process.env['SIM_BASE_URL'] ?? SIM_DEFAULT;
  return {
    openai: args.sim ? simUrl : (process.env['OPENAI_BASE_URL'] ?? 'https://api.openai.com/v1'),
    elevenlabs: args.sim ? simUrl : (process.env['ELEVENLABS_BASE_URL'] ?? 'https://api.elevenlabs.io/v1'),
    simUrl,
  };
};

// function declaration with an explicit never return so control flow narrows after calls
function fail(error: AppError, verbose: boolean): never {
  logger.error(`[${error.kind}] ${error.message}`);
  if (verbose && error.cause !== undefined) logger.error('cause', error.cause);
  process.exit(KIND_EXIT[error.kind]);
}

const fmt = (n: number): string => n.toFixed(1);

const printSummary = (m: Mastered): void => {
  const byProvider = R.pipe(
    m.plan.segments,
    R.countBy((s) => s.provider),
    R.entries(),
    R.map(([provider, n]) => `${provider}: ${n}`),
    R.join(', '),
  );
  console.log(`${chalk.green('✔')} ${m.project} -> ${m.finalPath}`);
  console.log(`  segments: ${m.plan.segments.length} (${byProvider})   skipped lines: ${m.skippedLines}`);
  console.log('  speaker loudness (LUFS before -> after):');
  const nameWidth = Math.max(...m.speakerLoudness.map((s) => s.speaker.length));
  const provWidth = Math.max(...m.speakerLoudness.map((s) => s.provider.length));
  for (const s of m.speakerLoudness) {
    const after = s.after === null ? '-' : fmt(s.after.lufs);
    console.log(`    ${s.speaker.padEnd(nameWidth)}  (${s.provider})${' '.repeat(provWidth - s.provider.length)}  ${fmt(s.before.lufs)} -> ${after}`);
  }
  const fm = m.finalMetrics;
  console.log(`  episode: ${fmt(fm.lufs)} LUFS, true peak ${fmt(fm.truePeak)} dBTP, LRA ${fmt(fm.loudnessRange)} LU`);
};

// --- args --------------------------------------------------------------------

const parsed = tryCatchSync(
  () => parseArgs({
    options: {
      project: { type: 'string' },
      input: { type: 'string', default: 'input' },
      config: { type: 'string', default: 'config.yaml' },
      provider: { type: 'string' },
      sim: { type: 'boolean', default: false },
      'sim-url': { type: 'string' },
      verbose: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  }),
  (cause) => appError('config', `Invalid arguments: ${describeCause(cause)}\n\n${USAGE}`),
);
if (!parsed.ok) fail(parsed.error, false);
const args = parsed.data.values;

if (args.help) {
  console.log(USAGE);
  process.exit(0);
}
const verbose = args.verbose === true;
if (verbose) process.env['LOG_LEVEL'] = 'debug';

if (args.provider !== undefined && args.provider !== 'openai' && args.provider !== 'elevenlabs') {
  fail(appError('config', `--provider must be openai or elevenlabs (got "${args.provider}")`), verbose);
}
const providerOverride = args.provider as Provider | undefined;

// --- preflights --------------------------------------------------------------

const fs = createBunFs();
const dsp = createFfmpegDsp();

const ffmpegCheck = await dsp.available();
if (!ffmpegCheck.ok) {
  fail(appError('config', 'ffmpeg not found on PATH - install it (nix: nixpkgs.ffmpeg, apt: ffmpeg) and retry'), verbose);
}

const sim = args.sim === true;
const urls = resolveBaseUrls({ sim, ...(args['sim-url'] !== undefined ? { simUrl: args['sim-url'] } : {}) });

if (sim) {
  const statusUrl = urls.simUrl.replace(/\/v1\/?$/, '') + '/sim/status';
  const status = await tryCatch(
    async () => {
      const res = await fetch(statusUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    (cause) => appError('config',
      `simulator not reachable at ${statusUrl} (${describeCause(cause)}) - start it: cd ../projects/elevenlabs-api-local && bun run start`,
      { cause }),
  );
  if (!status.ok) fail(status.error, verbose);
}

// --- config + keys -----------------------------------------------------------

const config = await loadConfig(fs, args.config ?? 'config.yaml');
if (!config.ok) fail(config.error, verbose);

// keys only for providers a character can actually resolve to; sim mode needs none
const neededProviders: ReadonlyArray<Provider> = providerOverride
  ? [providerOverride]
  : R.unique(config.data.characters.map((c) => resolveProvider(c, config.data.processing.defaultProvider)));

const keys: Record<Provider, string> = { openai: 'sim-key', elevenlabs: 'sim-key' };
if (!sim) {
  for (const provider of neededProviders) {
    const key = await loadApiKey(provider);
    if (!key.ok) fail(key.error, verbose);
    keys[provider] = key.data;
  }
}

// --- wiring ------------------------------------------------------------------

const tts: Record<Provider, TtsPort> = {
  openai: withLimit(withRetry(createOpenAiTts(keys.openai, urls.openai)), 10),
  elevenlabs: withLimit(withRetry(createElevenLabsTts(keys.elevenlabs, urls.elevenlabs)), 3),
};

const deps: Deps = {
  tts,
  dsp,
  fs,
  config: config.data,
  outputRoot: 'output',
  ...(providerOverride ? { providerOverride } : {}),
};

const run = pipeline(parse(deps), plan(deps), synthesize(deps), balance(deps), master(deps));

// --- project discovery + run -------------------------------------------------

const inputRoot = args.input ?? 'input';
let projects: ReadonlyArray<string>;
if (args.project !== undefined) {
  projects = [args.project];
} else {
  const dirs = await fs.listDirs(inputRoot);
  if (!dirs.ok) fail(dirs.error, verbose);
  else projects = R.sortBy(dirs.data, (d) => d);
}
if (projects!.length === 0) {
  fail(appError('validation', `no projects found under ${inputRoot}/`), verbose);
}

const failures: Array<{ project: string; error: AppError }> = [];
for (const project of projects!) {
  logger.info(`processing ${project}`);
  const result = await run({ project, dialoguePath: join(inputRoot, project, 'dialogue.txt') });
  if (result.ok) printSummary(result.data);
  else failures.push({ project, error: result.error });
}

if (failures.length > 0) {
  const byKind = R.groupBy(failures, (f) => f.error.kind);
  for (const [kind, group] of Object.entries(byKind)) {
    console.error(chalk.red(`[${kind}]`));
    for (const f of group) {
      console.error(`  ${chalk.red('✖')} ${f.project}: ${f.error.message}`);
      if (verbose && f.error.cause !== undefined) console.error('    cause:', f.error.cause);
    }
  }
  process.exit(KIND_EXIT[failures[0]!.error.kind]);
}
process.exit(0);
