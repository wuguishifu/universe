import { Injectable } from '@nestjs/common';
import { environmentConfig } from '@wuguishifu/environment';

@Injectable()
export class ConfigService {
  public readonly config = environmentConfig;
  public readonly isProduction = this.config.environmentKey === 'production';
  public readonly version = process.env.VERSION || '0.0.0';
}
