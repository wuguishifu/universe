import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Skips the API token check, e.g. for Kubernetes probes. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
