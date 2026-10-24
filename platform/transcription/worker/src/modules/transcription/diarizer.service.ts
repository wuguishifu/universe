import { Injectable, OnModuleDestroy } from '@nestjs/common';
import z from 'zod';

import { readFile } from 'fs/promises';

import { runProcess } from '@libs/nest-common';

import { EnvironmentService } from '../../config/environment';

import { type SpeakerTurn } from './speakers';

const diarizerJsonSchema = z.object({
  turns: z.array(
    z.object({ startMs: z.number(), endMs: z.number(), speaker: z.string() }),
  ),
});

@Injectable()
export class DiarizerService implements OnModuleDestroy {
  private readonly abortController = new AbortController();

  constructor(private readonly environmentService: EnvironmentService) {}

  onModuleDestroy() {
    this.abortController.abort();
  }

  /** Whether this worker has a diarizer (DIARIZER_PATH). */
  get available(): boolean {
    return !!this.environmentService.environment.diarizerPath;
  }

  /** Who spoke when in a 16kHz mono WAV. Turns overlap where people talk over each other. */
  public async diarize({
    wavPath,
    outputPath,
    minSpeakers,
    maxSpeakers,
    timeoutMs,
    signal,
  }: {
    wavPath: string;
    outputPath: string;
    minSpeakers?: number;
    maxSpeakers?: number;
    timeoutMs: number;
    /** Kills the diarizer, e.g. when the job fails elsewhere. */
    signal?: AbortSignal;
  }): Promise<{ turns: SpeakerTurn[]; diarizeProcessingTimeMs: number }> {
    const { diarizerPath, diarizerModelDir } =
      this.environmentService.environment;
    if (!diarizerPath || !diarizerModelDir) {
      throw new Error('This worker has no diarizer (DIARIZER_PATH)');
    }
    const startTime = Date.now();
    const abortSignal = signal
      ? AbortSignal.any([this.abortController.signal, signal])
      : this.abortController.signal;

    // prettier-ignore
    await runProcess(
      diarizerPath,
      [
        '--model-dir', diarizerModelDir,
        '--input', wavPath,
        '--output', outputPath,
        ...(minSpeakers ? ['--min-speakers', String(minSpeakers)] : []),
        ...(maxSpeakers ? ['--max-speakers', String(maxSpeakers)] : []),
      ],
      { timeoutMs, signal: abortSignal },
    );

    return {
      turns: diarizerJsonSchema.parse(
        JSON.parse(await readFile(outputPath, 'utf-8')),
      ).turns,
      diarizeProcessingTimeMs: Date.now() - startTime,
    };
  }
}
