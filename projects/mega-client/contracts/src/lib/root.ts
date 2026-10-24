import { c } from './contract';
import { accountRouter } from './routers/account.router';
import { transfersRouter } from './routers/transfers.router';
import { snapshotSchema } from './snapshot';

/** Every change answers with the snapshot it led to, which /stream also sends to everyone else. */
export const megaRootRouter = c.router(
  {
    transfers: transfersRouter,
    account: accountRouter,
    snapshot: {
      method: 'GET',
      path: '/snapshot',
      description: 'What /stream sends, for one-off reads.',
      responses: { 200: snapshotSchema },
    },
  },
  {
    pathPrefix: '/api',
    strictStatusCodes: true,
  },
);
