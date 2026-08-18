# voxmixture reference


## Dialogue format

`input/<project>/dialogue.txt`, one utterance per line:

```
Konrad: Hallo, dies ist ein Test.
Inga: Alles klingt gut.
```

- `Speaker: text` per line; speaker names match `config.yaml` characters case-insensitively.
- Any number of speakers, any turn order.
- Lines that do not match the format are skipped with a warning (the count appears in the
  run summary).


## config.yaml reference

```yaml
characters:
  - id: konrad                  # internal id
    name: Konrad                # speaker name as written in dialogue.txt
    provider: openai            # optional; omit to use processing.providers.default
    # gain_db: 0.0              # optional manual trim (dB) after segment normalization
    voices:
      openai:
        voice_id: onyx          # one of the 6 OpenAI voices
        model: tts-1            # default tts-1
      elevenlabs:
        voice_id: OI5E0KTcArkkIzhpC4xj
        settings:
          stability: 0.8
          similarity_boost: 0.8
          style: 0.0
          use_speaker_boost: true

processing:
  output:
    format: mp3                 # only mp3 is implemented
    bitrate: 192k
    sample_rate: 44100          # default 44100
    normalization: true         # final episode loudnorm pass
    target_lufs: -16.0          # final episode loudness target
    segment_normalization: true # default true; per-segment balancing before concat
    dialog_target_lufs: -18.0   # default -18; per-segment target
  providers:
    default: openai             # openai | elevenlabs
```

A character needs voice settings only for the provider it resolves to
(CLI `--provider` override > character `provider` > `providers.default`).

## Output naming

```
output/<project>/
  <project>.mp3            # the finished episode
  <project>_raw.wav        # concatenated mixdown before the final loudnorm
  segments/
    000_<speaker>.mp3      # raw TTS segment, zero-padded line index
    000_<speaker>.norm.wav # loudness-balanced WAV intermediate
```

## How loudness works

Each segment is analyzed and loudness-normalized to `dialog_target_lufs` before
concatenation. The concatenated mix then gets one final loudnorm pass to `target_lufs` and a single mp3
encode. The summary prints measured before/after LUFS per speaker; a warning appears if a
balanced speaker lands more than 1.5 LU off target (extremely peaked source clips are
true-peak-limited and can undershoot).

## CLI reference

```
voxmixture - dialogue scripts to TTS to one loudness-balanced episode

  --project <name>     process only input/<name> (default: every dir under --input)
  --input <dir>        projects root (default: input)
  --config <path>      config file (default: config.yaml)
  --provider <p>       openai | elevenlabs - force EVERY character to one provider
  --sim                use the local TTS simulator for both providers (no API keys needed)
  --sim-url <url>      simulator base URL (default: env SIM_BASE_URL or http://localhost:4880/v1)
  --verbose            debug logging (same as LOG_LEVEL=debug) + print error causes
  --help
```

Exit codes: 0 success, 2 config/preflight, 3 validation, 4 io, 5 tts, 6 dsp.

## Environment variables

| Variable | Meaning |
|---|---|
| `LOG_LEVEL` | debug, info (default), warn, error |
| `SIM_BASE_URL` | simulator base URL for `--sim` (default http://localhost:4880/v1) |
| `OPENAI_API_KEY`, `OPENAI_API_KEY_FILE` | OpenAI key (env or file path) |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_API_KEY_FILE` | ElevenLabs key (env or file path) |
| `OPENAI_BASE_URL`, `ELEVENLABS_BASE_URL` | API base URL overrides (non-sim runs) |

## Development

```sh
bun run typecheck   # tsc strict, no emit
bun run test        # vitest, pure domain + parsers, no network
bun run verify      # end-to-end against a local TTS simulator (free)
```

`bun run verify` and the CLI's `--sim` flag exercise the full pipeline against a local
mock TTS server on `SIM_BASE_URL` (default `http://localhost:4880/v1`) instead of the real
APIs. The mock server utility and is not part of this repo.

`verify/verify-real.ts` smoke-tests the real paid APIs. Needs keys and an
active ElevenLabs subscription, and refuses to run unless `VOXMIXTURE_REAL=1` is set.
