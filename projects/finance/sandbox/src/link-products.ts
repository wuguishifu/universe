import { Plaid } from './plaid.ts';
import type { LinkKind } from './store.ts';

// `products` are required: institutions that can't provide them are hidden in Link
// `optional_products` are added only when the institution supports them
// in production each product is billed per item, so only ask for what the dashboard needs
export const LINK_PRODUCTS: Record<
  LinkKind,
  { products: Plaid.Products[]; optional_products: Plaid.Products[] }
> = {
  // checking, savings and credit cards (Bank of America, Capital One)
  bank: {
    products: [Plaid.Products.Transactions],
    optional_products: [Plaid.Products.Liabilities],
  },
  // brokerages and 401(k)s (Fidelity, Schwab, Human Interest, Vestwell)
  investments: {
    products: [Plaid.Products.Investments],
    optional_products: [],
  },
};
