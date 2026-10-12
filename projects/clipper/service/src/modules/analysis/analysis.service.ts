import { Injectable } from '@nestjs/common';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { S3ObjectNotFoundError, S3Service } from '@libs/nest-common';
import {
  addUsage,
  costUsd,
  modelOutputSchema,
  NO_USAGE,
  type Outcome,
  PROXY,
  type RunOptions,
  type TokenUsage,
  toOutcome,
} from '@projects/clipper-contracts';
import { GeminiError, GeminiService } from './gemini.service';
import { MediaService } from './media.service';
import { clipContext, retryPrompt, systemInstruction } from './prompt';

/** An invalid answer gets asked for once more (saying what was wrong), then the clip job fails. */
const MAX_CALLS = 2;

export type Clip = {
  bucket: string;
  key: string;
  durationSec: number;
  game?: string;
};

export type Analysis = {
  outcome: Outcome;
  /** Summed over every call, including an invalid answer that was asked again. */
  usage: TokenUsage;
  costUsd: number;
  calls: number;
  mediaBytes: number;
  mediaDurationSec: number;
};

/** Carries what the attempt cost, since a call can be charged and still not give an answer. */
export class AnalysisError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly usage: TokenUsage,
    readonly costUsd: number,
  ) {
    super(message);
  }
}

@Injectable()
export class AnalysisService {
  constructor(
    private readonly s3: S3Service,
    private readonly media: MediaService,
    private readonly gemini: GeminiService,
  ) {}

  /** Finds a clip's moments: fetches its proxy, cuts it to what the options say, asks Gemini. */
  async analyze({
    clip,
    options,
    signal,
  }: {
    clip: Clip;
    options: RunOptions;
    signal: AbortSignal;
  }): Promise<Analysis> {
    const { model } = options;
    let usage = NO_USAGE;
    let spent = 0;
    const fail = (message: string, retryable: boolean) =>
      new AnalysisError(message, retryable, usage, spent);

    const workDir = await mkdtemp(path.join(tmpdir(), 'clipper-'));
    try {
      const proxyPath = path.join(workDir, 'proxy.mp4');
      try {
        await this.s3.downloadToFile(clip.bucket, clip.key, proxyPath);
      } catch (error) {
        if (error instanceof S3ObjectNotFoundError) {
          throw fail(`${error.message} (was the proxy uploaded?)`, false);
        }
        throw error;
      }

      let media;
      try {
        media = await this.media.prepare({
          proxyPath,
          workDir,
          media: options.media,
          clipDurationSec: clip.durationSec,
          tailSeconds: options.tailSeconds,
          signal,
        });
      } catch (error) {
        if (signal.aborted) throw error;
        // A proxy ffmpeg can't read (or with no audio, for an audio run) won't get better.
        throw fail(
          `Couldn't prepare the proxy: ${error instanceof Error ? error.message : error}`,
          false,
        );
      }
      const data = await readFile(media.path);
      if (data.length > PROXY.maxBytes) {
        throw fail(
          `${media.mimeType} is ${data.length} bytes, over the ${PROXY.maxBytes} inline limit`,
          false,
        );
      }

      const system = systemInstruction(options);
      const context = clipContext({
        game: clip.game,
        clipDurationSec: clip.durationSec,
        mediaDurationSec: media.durationSec,
        offsetSec: media.offsetSec,
        instructions: options.instructions,
      });
      let retry: { answer: string; prompt: string } | undefined;
      let lastError = '';
      for (let call = 1; call <= MAX_CALLS; call++) {
        let answer: { text: string; usage: TokenUsage };
        try {
          answer = await this.gemini.generate({
            options,
            media: { data, mimeType: media.mimeType },
            systemInstruction: system,
            context,
            retry,
            signal,
          });
        } catch (error) {
          if (!(error instanceof GeminiError)) throw error;
          if (error.usage) {
            usage = addUsage(usage, error.usage);
            spent += costUsd(model, error.usage, new Date());
          }
          throw fail(error.message, error.retryable);
        }
        usage = addUsage(usage, answer.usage);
        spent += costUsd(model, answer.usage, new Date());

        const result = parseAnswer(answer.text, media);
        if (result.ok) {
          return {
            outcome: result.outcome,
            usage,
            costUsd: spent,
            calls: call,
            mediaBytes: data.length,
            mediaDurationSec: media.durationSec,
          };
        }
        lastError = result.error;
        retry = { answer: answer.text, prompt: retryPrompt(result.error) };
      }
      throw fail(
        `Gemini's answer was invalid ${MAX_CALLS} times; last: ${lastError}`,
        false,
      );
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}

function parseAnswer(
  text: string,
  media: { durationSec: number; offsetSec: number },
): { ok: true; outcome: Outcome } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: `not JSON: ${text.slice(0, 200)}` };
  }
  const parsed = modelOutputSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: `wrong shape: ${parsed.error.message}` };
  }
  return toOutcome(parsed.data, {
    mediaDurationSec: media.durationSec,
    offsetSec: media.offsetSec,
  });
}
