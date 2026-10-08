import {
  DynamicModule,
  InjectionToken,
  Module,
  ModuleMetadata,
  OptionalFactoryDependency,
} from '@nestjs/common';
import { CLAUDE_CONFIG, type ClaudeConfig } from './claude';
import { ClaudeService } from './claude.service';

export type ClaudeModuleAsyncOptions = Pick<ModuleMetadata, 'imports'> & {
  inject?: (InjectionToken | OptionalFactoryDependency)[];
  useFactory: (...args: never[]) => ClaudeConfig | Promise<ClaudeConfig>;
};

@Module({})
export class ClaudeModule {
  public static forRootAsync({
    imports = [],
    inject = [],
    useFactory,
  }: ClaudeModuleAsyncOptions): DynamicModule {
    return {
      module: ClaudeModule,
      global: true,
      imports,
      providers: [
        { provide: CLAUDE_CONFIG, inject, useFactory },
        ClaudeService,
      ],
      exports: [ClaudeService],
    };
  }
}
