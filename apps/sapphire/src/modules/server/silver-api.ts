import { initClient, tsRestFetchApi } from '@ts-rest/core';
import { silverRootRouter } from '@universe/contracts-silver';
import 'server-only';

const silverBaseUrl =
  process.env.SILVER_BASE_URL ?? 'https://silver.wuguishifu.dev';

export const silverApi = initClient(silverRootRouter, {
  baseUrl: silverBaseUrl,
  baseHeaders: {},
  api: (args) => {
    args.headers.authorization = `Bearer ${process.env.SILVER_ADMIN_API_TOKEN}`;
    return tsRestFetchApi(args);
  },
});
