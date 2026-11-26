// Creates sandbox items without going through the Link UI, so fetch.ts has data to work with.
//
// Usage: nx seed finance-sandbox
import { env } from './env.ts';
import { LINK_PRODUCTS } from './link-products.ts';
import { formatPlaidError, plaid } from './plaid.ts';
import { itemLabel, saveItem, type LinkKind } from './store.ts';

if (env.PLAID_ENV !== 'sandbox') {
  console.error(
    'ERROR: seeding only works with PLAID_ENV=sandbox, use `nx link finance-sandbox` for real accounts',
  );
  process.exit(1);
}

// First Platypus Bank, plaid's general-purpose sandbox institution
const SANDBOX_INSTITUTION_ID = 'ins_109508';

const seed = async (kind: LinkKind) => {
  const { products, optional_products } = LINK_PRODUCTS[kind];
  const { public_token } = await plaid.sandbox.createPublicToken({
    institution_id: SANDBOX_INSTITUTION_ID,
    initial_products: [...products, ...optional_products],
  });
  const { access_token, item_id } = await plaid.item.exchangePublicToken({
    public_token,
  });
  const { item } = await plaid.item.get({ access_token });
  const stored = {
    item_id,
    access_token,
    institution_id: item.institution_id ?? null,
    institution_name: item.institution_name ?? null,
    kind,
    linked_at: new Date().toISOString(),
  };
  saveItem(stored);
  console.log(
    `Seeded ${itemLabel(stored)} (${kind}): ${item.products.join(', ')}`,
  );
};

for (const kind of ['bank', 'investments'] as const) {
  try {
    await seed(kind);
  } catch (error) {
    console.error(`ERROR: seeding ${kind} item: ${formatPlaidError(error)}`);
    process.exitCode = 1;
  }
}
