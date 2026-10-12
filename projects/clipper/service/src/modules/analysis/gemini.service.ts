import {
  ApiError,
  type GenerateContentResponseUsageMetadata,
  GoogleGenAI,
  MediaModality,
  MediaResolution,
  type ThinkingConfig,
  ThinkingLevel,
} from '@google/genai';
import { Injectable } from '@nestjs/common';
import { type RunOptions, type TokenUsage } from '@projects/clipper-contracts';
import { EnvironmentService } from '../../environment/environment';
import { MODEL_OUTPUT_JSON_SCHEMA } from './prompt';

/** A 2-minute clip at low thinking takes well under a minute; this catches a hung request. */
const REQUEST_TIMEOUT_MS = 3 * 60 * 1000;

const MEDIA_RESOLUTION = {
  low: MediaResolution.MEDIA_RESOLUTION_LOW,
  medium: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
  high: MediaResolution.MEDIA_RESOLUTION_HIGH,
} satisfies Record<RunOptions['mediaResolution'], MediaResolution>;

const THINKING_LEVEL = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
} satisfies Record<RunOptions['thinkingLevel'], ThinkingLevel>;

/** Gemini 2.5 models take a token budget instead of a level. */
const THINKING_BUDGET = {
  minimal: 0,
  low: 1024,
  medium: 4096,
  high: 16384,
} satisfies Record<RunOptions['thinkingLevel'], number>;

/** Finish reasons that asking again won't change. */
const BLOCKED_FINISH_REASONS = new Set([
  'SAFETY',
  'RECITATION',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'IMAGE_SAFETY',
]);

export class GeminiError extends Error {
  constructor(
    message: string,
    /** Whether trying again later could work (rate limits, outages, timeouts). */
    readonly retryable: boolean,
    /** What the call used, when it got far enough to be charged. */
    readonly usage?: TokenUsage,
  ) {
    super(message);
  }
}

@Injectable()
export class GeminiService {
  private readonly ai: GoogleGenAI;

  constructor(environmentService: EnvironmentService) {
    this.ai = new GoogleGenAI({
      apiKey: environmentService.environment.geminiApiKey,
    });
  }

  /**
   * One call: the media inline, then the clip's details, then (when asking again) the answer that
   * couldn't be used and what was wrong with it. Returns the raw JSON text.
   */
  async generate({
    options,
    media,
    systemInstruction,
    context,
    retry,
    signal,
  }: {
    options: RunOptions;
    media: { data: Buffer; mimeType: string };
    systemInstruction: string;
    context: string;
    retry?: { answer: string; prompt: string };
    signal: AbortSignal;
  }): Promise<{ text: string; usage: TokenUsage }> {
    const isVideo = media.mimeType.startsWith('video/');
    let response;
    try {
      response = await this.ai.models.generateContent({
        model: options.model,
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: media.mimeType,
                  data: media.data.toString('base64'),
                },
                ...(isVideo && { videoMetadata: { fps: options.fps } }),
              },
              { text: context },
            ],
          },
          ...(retry
            ? [
                { role: 'model', parts: [{ text: retry.answer }] },
                { role: 'user', parts: [{ text: retry.prompt }] },
              ]
            : []),
        ],
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseJsonSchema: MODEL_OUTPUT_JSON_SCHEMA,
          ...(isVideo && {
            mediaResolution: MEDIA_RESOLUTION[options.mediaResolution],
          }),
          thinkingConfig: thinkingConfig(options),
          abortSignal: signal,
          httpOptions: { timeout: REQUEST_TIMEOUT_MS },
        },
      });
    } catch (error) {
      if (signal.aborted) throw error;
      if (error instanceof ApiError) {
        // Bad requests (unreadable media, unknown model) fail the same way every time.
        const retryable = error.status !== 400 && error.status !== 404;
        throw new GeminiError(
          `Gemini ${error.status}: ${error.message}`,
          retryable,
        );
      }
      throw new GeminiError(
        `Gemini request failed: ${error instanceof Error ? error.message : error}`,
        true,
      );
    }

    const usage = toTokenUsage(response.usageMetadata);
    const blocked =
      response.promptFeedback?.blockReason ??
      [response.candidates?.[0]?.finishReason].find(
        (reason) => reason && BLOCKED_FINISH_REASONS.has(reason),
      );
    if (blocked) {
      throw new GeminiError(
        `Gemini blocked the clip: ${blocked}`,
        false,
        usage,
      );
    }
    const text = response.text;
    if (!text) {
      throw new GeminiError(
        `Gemini returned no text (finish reason ${response.candidates?.[0]?.finishReason ?? 'unknown'})`,
        true,
        usage,
      );
    }
    return { text, usage };
  }
}

function thinkingConfig(options: RunOptions): ThinkingConfig {
  return options.model.startsWith('gemini-2.5-')
    ? { thinkingBudget: THINKING_BUDGET[options.thinkingLevel] }
    : { thinkingLevel: THINKING_LEVEL[options.thinkingLevel] };
}

function toTokenUsage(
  metadata: GenerateContentResponseUsageMetadata | undefined,
): TokenUsage {
  const prompt = metadata?.promptTokenCount ?? 0;
  const audioInput =
    metadata?.promptTokensDetails
      ?.filter(({ modality }) => modality === MediaModality.AUDIO)
      .reduce((sum, { tokenCount }) => sum + (tokenCount ?? 0), 0) ?? 0;
  return {
    input: prompt - audioInput,
    audioInput,
    output: metadata?.candidatesTokenCount ?? 0,
    thinking: metadata?.thoughtsTokenCount ?? 0,
  };
}
