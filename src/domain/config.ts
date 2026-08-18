export type Provider = 'openai' | 'elevenlabs';

export type OpenAIVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

export type ElevenLabsVoiceSettings = {
  readonly stability: number;
  readonly similarityBoost: number;
  readonly style: number;
  readonly useSpeakerBoost: boolean;
};

export type CharacterConfig = {
  readonly id: string;
  readonly name: string;
  // optional per-character provider; falls back to processing default
  readonly provider?: Provider;
  // optional manual trim in dB, applied after segment normalization
  readonly gainDb?: number;
  readonly voices: {
    readonly openai?: { readonly voiceId: OpenAIVoice; readonly model: string };
    readonly elevenlabs?: { readonly voiceId: string; readonly settings: ElevenLabsVoiceSettings };
  };
};

export type OutputConfig = {
  readonly format: 'mp3';                 // only mp3 is implemented; the type says so honestly
  readonly bitrate: string;               // e.g. '192k'
  readonly sampleRate: number;            // e.g. 44100
  readonly normalization: boolean;
  readonly targetLufs: number;            // final episode target, e.g. -16
  readonly segmentNormalization: boolean;
  readonly dialogTargetLufs: number;      // per-segment target, e.g. -18
};

export type AppConfig = {
  readonly characters: ReadonlyArray<CharacterConfig>;
  readonly processing: {
    readonly output: OutputConfig;
    readonly defaultProvider: Provider;
  };
};
