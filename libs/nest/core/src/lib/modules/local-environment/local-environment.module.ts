import { DynamicModule, Module, Type } from '@nestjs/common';

@Module({})
export class LocalEnvironmentModule {
  /**
   * Provides an app's EnvironmentService (see createEnvironmentService) globally.
   */
  public static forRoot(service: Type): DynamicModule {
    return {
      module: LocalEnvironmentModule,
      global: true,
      providers: [service],
      exports: [service],
    };
  }
}
