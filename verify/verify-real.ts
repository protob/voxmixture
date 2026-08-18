// Paid pre-release smoke check against the REAL OpenAI and ElevenLabs APIs.
// Owner-triggered only.
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createBunFs } from '../src/adapters/bun-fs';
import { createFfmpegDsp } from '../src/adapters/ffmpeg-dsp';
import { loadConfig } from '../src/adapters/yaml-config';

if (process.env['VOXMIXTURE_REAL'] !== '1') {
  console.error('verify-real refused to run: this spends OpenAI/ElevenLabs credits and');
  console.error('requires an active ElevenLabs subscription - currently none.');
  console.error('Set VOXMIXTURE_REAL=1 (plus OPENAI_API_KEY / ELEVENLABS_API_KEY) to run it.');
  process.exit(2);
}

const PROJECT = 'sample_dialogue';
const OUTPUT_DIR = join('output', PROJECT);
const FINAL = join(OUTPUT_DIR, `${PROJECT}.mp3`);

let failures = 0;
const check = (name: string, pass: boolean, detail?: string): void => {
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!pass) failures += 1;
};

await rm(OUTPUT_DIR, { recursive: true, force: true });

const proc = Bun.spawnSync(['bun', 'src/app/cli.ts', '--project', PROJECT], {
  stdout: 'inherit',
  stderr: 'inherit',
});
check('cli run against real APIs exits 0', proc.exitCode === 0);

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

const config = await loadConfig(fs, 'config.yaml');
if (!config.ok) {
  console.error(`config load failed: ${config.error.message}`);
  process.exit(2);
}
const metrics = await createFfmpegDsp().analyze(FINAL);
check('episode loudness measured', metrics.ok);
if (metrics.ok) {
  const target = config.data.processing.output.targetLufs;
  check(`episode LUFS within 1.5 of ${target}`, Math.abs(metrics.data.lufs - target) <= 1.5, `measured ${metrics.data.lufs}`);
}

console.log(failures === 0 ? '\nverify-real: all checks passed' : `\nverify-real: ${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
