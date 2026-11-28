import { financeQuery } from './auth';

/**
 * The signed-in user's items and accounts for the home page. Never includes access tokens.
 */
export const overview = financeQuery({
  args: {},
  handler: async (ctx) => {
    const { userId } = ctx.viewer;

    const [items, accounts] = await Promise.all([
      ctx.db
        .query('financeItems')
        .withIndex('by_userId', (q) => q.eq('userId', userId))
        .collect(),
      ctx.db
        .query('financeAccounts')
        .withIndex('by_userId', (q) => q.eq('userId', userId))
        .collect(),
    ]);
    const institutions = new Map(
      items.map((item) => [item.itemId, item.institutionName]),
    );

    return {
      items: items
        .sort((a, b) => a.linkedAt - b.linkedAt)
        .map((item) => ({
          itemId: item.itemId,
          kind: item.kind,
          institutionName: item.institutionName,
          status: item.status,
          errorCode: item.errorCode ?? null,
          consentExpirationTime: item.consentExpirationTime ?? null,
          lastSyncedAt: item.lastSyncedAt ?? null,
        })),
      accounts: accounts.map(
        ({ _id, _creationTime: _, userId: _userId, ...account }) => ({
          ...account,
          id: _id,
          institutionName: institutions.get(account.itemId) ?? null,
        }),
      ),
    };
  },
});
