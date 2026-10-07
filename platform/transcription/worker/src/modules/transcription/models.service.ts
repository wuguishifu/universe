import { Injectable } from '@nestjs/common';
import { existsSync } from 'fs';
import path from 'path';
import { EnvironmentService } from '../../environment';

@Injectable()
export class ModelsService {
  constructor(private readonly environmentService: EnvironmentService) {}

  get defaultModel(): string {
    return this.environmentService.environment.whisperDefaultModel;
  }

  get models(): string[] {
    return this.environmentService.environment.whisperModels;
  }

  private resolve(requested?: string): string | null {
    const model = requested ?? this.defaultModel;
    return this.models.includes(model) ? model : null;
  }

  private installedPath(model: string): string | null {
    const modelPath = path.join(
      this.environmentService.environment.whisperModelsDir,
      `ggml-${model}.bin`,
    );
    return existsSync(modelPath) ? modelPath : null;
  }

  public resolveModel(
    requested?: string,
  ): { model: string; modelPath: string } | null {
    const model = this.resolve(requested);
    if (!model) return null;
    const modelPath = this.installedPath(model);
    if (!modelPath) return null;
    return { model, modelPath };
  }
}
