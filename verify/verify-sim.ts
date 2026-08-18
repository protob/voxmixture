// Free full-stack check against the local simulator. This is what `bun run verify` runs.
// Requires: simulator on :4880 (or SIM_BASE_URL), ffmpeg + ffprobe on PATH.
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tryCatch } from '../src/shared/result';
import { appError, describeCause } from '../src/domain/errors';
import { createBunFs } from '../src/adapters/bun-fs';
import { createFfmpegDsp } from '../src/adapters/ffmpeg-dsp';
import { loadConfig } from '../src/adapters/yaml-config';

const SIM_BASE = process.env['SIM_BASE_URL'] ?? 'http://localhost:4880/v1';
const SIM_ROOT = SIM_BASE.replace(/\/v1\/?$/, '');
const PROJECT = 'sample_dialogue';
const OUTPUT_DIR = join('output', PROJECT);
const FINAL = join(OUTPUT_DIR, `${PROJECT}.mp3`);

let failures = 0;
const check = (name: string, pass: boolean, detail?: string): void => {
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!pass) failures += 1;
};

const status = await tryCatch(
  async () => {
    const res = await fetch(`${SIM_ROOT}/sim/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
  (cause) => appError('config', describeCause(cause)),
);
if (!status.ok) {
  console.error(`simulator not reachable at ${SIM_ROOT}/sim/status - start it: cd ../projects/elevenlabs-api-local && bun run start`);
  process.exit(2);
}
check('simulator reachable', true);

// clean slate
await rm(OUTPUT_DIR, { recursive: true, force: true });

// the real CLI, exactly as a user would run it
const runCli = (): number => {
  const proc = Bun.spawnSync(['bun', 'src/app/cli.ts', '--sim', '--project', PROJECT], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return proc.exitCode;
};
check('cli --sim run exits 0', runCli() === 0);

// artifact exists and is a 44100 Hz 192k mp3
const fs = createBunFs();
check('final mp3 exists', await fs.exists(FINAL), FINAL);

const probe = Bun.spawnSync(['ffprobe', '-v', 'error', '-select_streams', 'a:0',
  '-show_entries', 'stream=codec_name,sample_rate,bit_rate', '-of', 'json', FINAL]);
const probed = probe.exitCode === 0
  ? (JSON.parse(probe.stdout.toString()) as { streams?: Array<{ codec_name?: string; sample_rate?: string; bit_rate?: string }> })
  : null;
const stream = probed?.streams?.[0];
check('ffprobe: mp3 codec', stream?.codec_name === 'mp3', stream?.codec_name);
check('ffprobe: 44100 Hz', stream?.sample_rate === '44100', stream?.sample_rate);
check('ffprobe: 192k bitrate', stream?.bit_rate === '192000', stream?.bit_rate);

// measured episode loudness within 1.5 LU of the configured target
const config = await loadConfig(fs, 'config.yaml');
if (!config.ok) {
  console.error(`config load failed: ${config.error.message}`);
  process.exit(2);
}
const dsp = createFfmpegDsp();
const metrics = await dsp.analyze(FINAL);
check('episode loudness measured', metrics.ok);
if (metrics.ok) {
  const target = config.data.processing.output.targetLufs;
  const delta = Math.abs(metrics.data.lufs - target);
  check(`episode LUFS within 1.5 of ${target}`, delta <= 1.5, `measured ${metrics.data.lufs}`);
}

// retry path: two armed rate-limit faults must not fail the run
await fetch(`${SIM_ROOT}/sim/fault`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ kind: 'rate-limit', times: 2 }),
});
check('cli survives 2 rate-limit faults (retry path)', runCli() === 0);
await fetch(`${SIM_ROOT}/sim/reset`, { method: 'POST' });

console.log(failures === 0 ? '\nverify-sim: all checks passed' : `\nverify-sim: ${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
