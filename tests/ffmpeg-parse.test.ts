import { describe, expect, it } from 'vitest';
import { parseLoudnorm } from '../src/adapters/ffmpeg-dsp';

// real ffmpeg stderr, generated from the simulator fixture inga-1.mp3 with:
// ffmpeg -hide_banner -i fixtures/inga-1.mp3 -af loudnorm=print_format=json -f null -
const FIXTURE = `      encoder         : Lavc60.31.102 pcm_s16le
size=       0kB time=00:00:00.00 bitrate=N/A speed=   0x    [out#0/null @ 0x5f8ed515c000] video:0kB audio:4085kB subtitle:0kB other streams:0kB global headers:0kB muxing overhead: unknown
size=N/A time=00:00:08.00 bitrate=N/A speed=35.5x
[Parsed_loudnorm_0 @ 0x5f8ed516ac80]
{
\t"input_i" : "-26.28",
\t"input_tp" : "-1.24",
\t"input_lra" : "7.70",
\t"input_thresh" : "-36.89",
\t"output_i" : "-25.96",
\t"output_tp" : "-2.00",
\t"output_lra" : "4.10",
\t"output_thresh" : "-36.43",
\t"normalization_type" : "dynamic",
\t"target_offset" : "1.96"
}
`;

describe('parseLoudnorm (B1 regression)', () => {
  it('maps input_i to lufs, input_tp to truePeak, input_lra to loudnessRange', () => {
    const result = parseLoudnorm(FIXTURE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.lufs).toBeCloseTo(-26.28, 2);
    expect(result.data.truePeak).toBeCloseTo(-1.24, 2);
    expect(result.data.loudnessRange).toBeCloseTo(7.7, 2);
  });

  it('lufs equals the fixture input_i, never a fabricated -24.0 (the exact B1 mistake)', () => {
    const result = parseLoudnorm(FIXTURE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.lufs).toBe(-26.28);
    expect(result.data.lufs).not.toBe(-24.0);
  });

  it('returns an error for stderr without a JSON block (B2: no invented numbers)', () => {
    const result = parseLoudnorm('frame= 100 fps= 25 size= 1024kB');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('dsp');
  });

  it('returns an error when the JSON is missing input_i (B2: no invented numbers)', () => {
    const result = parseLoudnorm('{"output_i": "-24.0", "input_tp": "-1.0", "input_lra": "2.0"}');
    expect(result.ok).toBe(false);
  });

  it('returns an error for unparseable JSON', () => {
    const result = parseLoudnorm('noise { not json } noise');
    expect(result.ok).toBe(false);
  });
});
