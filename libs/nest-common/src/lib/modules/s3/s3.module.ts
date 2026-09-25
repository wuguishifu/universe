import {
  DynamicModule,
  InjectionToken,
  Module,
  ModuleMetadata,
  OptionalFactoryDependency,
} from '@nestjs/common';
import { S3_CONFIG, S3Props } from './s3';
import { S3Service } from './s3.service';

export type S3ModuleAsyncOptions = Pick<ModuleMetadata, 'imports'> & {
  inject?: (InjectionToken | OptionalFactoryDependency)[];
  /** Return null to register an unconfigured S3Service (see S3Service.isConfigured). */
  useFactory: (...args: never[]) => S3Props | null | Promise<S3Props | null>;
};

@Module({})
export class S3Module {
  public static forRoot(config: S3Props | null): DynamicModule {
    return {
      module: S3Module,
      global: true,
      providers: [{ provide: S3_CONFIG, useValue: config }, S3Service],
      exports: [S3Service],
    };
  }

  public static forRootAsync({
    imports = [],
    inject = [],
    useFactory,
  }: S3ModuleAsyncOptions): DynamicModule {
    return {
      module: S3Module,
      global: true,
      imports,
      providers: [{ provide: S3_CONFIG, inject, useFactory }, S3Service],
      exports: [S3Service],
    };
  }
}
