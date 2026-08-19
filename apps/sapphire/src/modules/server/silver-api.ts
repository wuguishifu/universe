import 'server-only';

import { initClient, tsRestFetchApi } from '@ts-rest/core';
import { silverRootRouter } from '@universe/contracts-silver';

const silverBaseUrl =
  process.env.SILVER_BASE_URL ?? 'https://silver.wuguishifu.dev';

export const silverApi = initClient(silverRootRouter, {
  baseUrl: silverBaseUrl,
  baseHeaders: {},
  api: (args) => {
    args.headers.Authorization = `Bearer ${process.env.SILVER_ADMIN_API_TOKEN}`;
    args.headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID ?? '';
    args.headers['CF-Access-Client-Secret'] =
      process.env.CF_ACCESS_CLIENT_SECRET ?? '';
    return tsRestFetchApi(args);
  },
});
