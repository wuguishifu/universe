import { Logger } from '@nestjs/common';

import { Log } from '../host/ports';

/** The host's `Log` on a Nest logger, one structured object per line in JSON mode. */
export const nestLog = (logger: Logger): Log => ({
  debug: (message, data) => logger.debug({ message, ...data }),
  info: (message, data) => logger.log({ message, ...data }),
  warn: (message, data) => logger.warn({ message, ...data }),
  error: (message, data) => logger.error({ message, ...data }),
});
