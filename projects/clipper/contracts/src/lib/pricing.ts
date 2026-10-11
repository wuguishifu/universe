// No imports, so the service's tests can load this with Node's type stripping.

type ModelPrice = {
  /** USD per million prompt tokens of text, images and video. */
  inputUsdPerM: number;
  /** USD per million prompt tokens of audio, which some models charge more for. */
  audioInputUsdPerM: number;
  /** USD per million generated tokens, thinking included. */
  outputUsdPerM: number;
};

type PricePeriod = ModelPrice & {
  /** The first day (UTC) this price no longer applies. The last period has none. */
  until?: string;
};

export const CLIPPER_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
] as const;
export type ClipperModel = (typeof CLIPPER_MODELS)[number];
export const DEFAULT_MODEL: ClipperModel = 'gemini-3.8-flash';

/**
 * Standard (not Batch API) Gemini prices, from https://ai.google.dev/gemini-api/docs/pricing as of
 * October 2026. Runs can only use a model listed here, so every job's cost is known.
 */
export const MODEL_PRICING: Record<ClipperModel, readonly PricePeriod[]> = {
  'gemini-3.8-flash': [
    {
      until: '2027-01-01',
      inputUsdPerM: 0.75,
      audioInputUsdPerM: 0.75,
      outputUsdPerM: 3.75,
    },
    { inputUsdPerM: 1.5, audioInputUsdPerM: 1.5, outputUsdPerM: 7.5 },
  ],
  'gemini-3.6-flash': [
    {
      until: '2027-01-01',
      inputUsdPerM: 0.75,
      audioInputUsdPerM: 0.75,
      outputUsdPerM: 3.75,
    },
    { inputUsdPerM: 1.5, audioInputUsdPerM: 1.5, outputUsdPerM: 7.5 },
  ],
  'gemini-3-flash-preview': [
    { inputUsdPerM: 0.5, audioInputUsdPerM: 1, outputUsdPerM: 3 },
  ],
  'gemini-2.5-flash': [
    { inputUsdPerM: 0.3, audioInputUsdPerM: 1, outputUsdPerM: 2.5 },
  ],
  'gemini-3.5-flash-lite': [
    { inputUsdPerM: 0.3, audioInputUsdPerM: 0.3, outputUsdPerM: 2.5 },
  ],
  'gemini-3.1-flash-lite': [
    { inputUsdPerM: 0.25, audioInputUsdPerM: 0.5, outputUsdPerM: 1.5 },
  ],
  'gemini-2.5-flash-lite': [
    { inputUsdPerM: 0.1, audioInputUsdPerM: 0.3, outputUsdPerM: 0.4 },
  ],
};

/** What one Gemini call used, as its usageMetadata reports it. */
export type TokenUsage = {
  /** Prompt tokens other than audio: the instructions and the video frames. */
  input: number;
  audioInput: number;
  /** The answer itself. */
  output: number;
  thinking: number;
};

export function modelPrice(model: ClipperModel, at: Date): ModelPrice {
  const periods = MODEL_PRICING[model];
  const day = at.toISOString().slice(0, 10);
  const period =
    periods.find(({ until }) => !until || day < until) ?? periods.at(-1);
  if (!period) throw new Error(`No price for ${model}`);
  return period;
}

export function costUsd(
  model: ClipperModel,
  usage: TokenUsage,
  at: Date,
): number {
  const price = modelPrice(model, at);
  return (
    (usage.input * price.inputUsdPerM +
      usage.audioInput * price.audioInputUsdPerM +
      (usage.output + usage.thinking) * price.outputUsdPerM) /
    1_000_000
  );
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    audioInput: a.audioInput + b.audioInput,
    output: a.output + b.output,
    thinking: a.thinking + b.thinking,
  };
}

export const NO_USAGE: TokenUsage = {
  input: 0,
  audioInput: 0,
  output: 0,
  thinking: 0,
};
