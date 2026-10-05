import 'dotenv/config';

import { Logger } from '@nestjs/common';
import { createFastifyApp } from '@libs/nest-common';

import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await createFastifyApp(AppModule);
  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  Logger.log(`🚀 Clipper server is running on: ${app.getUrl()}`);
}

bootstrap();
