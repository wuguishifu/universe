import { Injectable } from '@nestjs/common';
import { existsSync } from 'fs';
import path from 'path';
import { EnvironmentService } from '../../environment/environment';

/**
 * The allow-list of models callers may request. Both roles use it: the API to reject unknown
 * models up front, the worker to find the model file. Keep WHISPER_MODELS identical on both.
 */
@Injectable()
export class WhisperModelsService {
  constructor(private readonly environmentService: EnvironmentService) {}

  get defaultModel(): string {
    return this.environmentService.environment.whisperDefaultModel;
  }

  get models(): string[] {
    return this.environmentService.environment.whisperModels;
  }

  get vadModelPath(): string | undefined {
    return this.environmentService.environment.whisperVadModelPath;
  }

  /** Returns the model to use, or null if the requested one isn't allowed. */
  resolve(requested: string | undefined): string | null {
    const model = requested ?? this.defaultModel;
    return this.models.includes(model) ? model : null;
  }

  /** Path to an allowed model's weights, or null if the file isn't installed on this worker. */
  installedPath(model: string): string | null {
    const modelPath = path.join(
      this.environmentService.environment.whisperModelsDir,
      `ggml-${model}.bin`,
    );
    return existsSync(modelPath) ? modelPath : null;
  }
}
