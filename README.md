# voxmixture

A command-line tool that turns a `Speaker: text` dialogue script into a single
loudness-balanced mp3, synthesizing each line through OpenAI or ElevenLabs TTS.

## Requirements

- [Bun](https://bun.sh) >= 1.1
- **ffmpeg on PATH**
- API keys for OpenAI and/or ElevenLabs

## Quick start

```sh
bun install
bun run start -- --project sample_dialogue
# -> output/sample_dialogue/sample_dialogue.mp3
```

Set keys via environment (or point at secret files, e.g. an agenix path):

| Variable | Meaning |
|---|---|
| `OPENAI_API_KEY` / `ELEVENLABS_API_KEY` | keys as plain env vars |
| `OPENAI_API_KEY_FILE` / `ELEVENLABS_API_KEY_FILE` | path to a file containing the key |
| `OPENAI_BASE_URL` / `ELEVENLABS_BASE_URL` | override the API base URLs |



## Documentation

[docs/reference.md](docs/reference.md) - dialogue format, `config.yaml` reference, output
naming, loudness balancing, CLI flags, environment variables, development.

## License

MIT. See [LICENSE](LICENSE).
