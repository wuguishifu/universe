import { z } from 'zod';

/** Which Plaid products to link with: `bank` for checking, savings and credit cards; `investments` for brokerages and 401(k)s. */
export const linkKindSchema = z.enum(['bank', 'investments']);
export type LinkKind = z.infer<typeof linkKindSchema>;

export const errorBodySchema = z.object({
  message: z.string(),
  /** Stable code for the UI to branch on, e.g. ITEM_NOT_FOUND. */
  code: z.string().optional(),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;

/** What the web app gets back after linking. The full item is in convex (api.finance.items.list). */
export const linkedItemSchema = z.object({
  itemId: z.string(),
  kind: linkKindSchema,
  institutionName: z.string().nullable(),
});
export type LinkedItem = z.infer<typeof linkedItemSchema>;
