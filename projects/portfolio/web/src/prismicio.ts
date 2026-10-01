import {
  createClient as baseCreateClient,
  type ClientConfig,
} from '@prismicio/client';
import { enableAutoPreviews } from '@prismicio/next';

import sm from '../slicemachine.config.json';
import { routes } from './routes';

const repositoryName = sm.repositoryName;

export const PRISMIC_SECRET_HEADER = 'x-prismic-secret';

/**
 * Creates a Prismic client for the project's repository. The client is used to
 * query content from the Prismic API.
 *
 * @param config - Configuration for the Prismic client.
 */
export const createClient = (config: ClientConfig = {}) => {
  const client = baseCreateClient(repositoryName, {
    routes,
    fetchOptions:
      process.env.NODE_ENV === 'production'
        ? { next: { tags: ['prismic'] }, cache: 'force-cache' }
        : { next: { revalidate: 5 } },
    ...config,
  });

  enableAutoPreviews({ client });

  return client;
};
