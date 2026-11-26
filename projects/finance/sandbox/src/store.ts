import { z } from 'zod';

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { env, PROJECT_ROOT } from './env.ts';

// access tokens are long-lived credentials: keep them out of git (see .gitignore) and owner-only
export const DATA_DIR = join(PROJECT_ROOT, '.data', env.PLAID_ENV);
const ITEMS_FILE = join(DATA_DIR, 'items.json');

export const linkKindSchema = z.enum(['bank', 'investments']);
export type LinkKind = z.infer<typeof linkKindSchema>;

const storedItemSchema = z.object({
  item_id: z.string(),
  access_token: z.string(),
  institution_id: z.string().nullable(),
  institution_name: z.string().nullable(),
  kind: linkKindSchema,
  linked_at: z.string(),
});
export type StoredItem = z.infer<typeof storedItemSchema>;

export const ensureDataDir = (...subdirs: string[]): string => {
  const dir = join(DATA_DIR, ...subdirs);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
};

export const loadItems = (): StoredItem[] =>
  existsSync(ITEMS_FILE)
    ? z
        .array(storedItemSchema)
        .parse(JSON.parse(readFileSync(ITEMS_FILE, 'utf8')))
    : [];

export const saveItem = (item: StoredItem): void => {
  ensureDataDir();
  // relinking the same item replaces it instead of duplicating it
  const items = loadItems().filter(({ item_id }) => item_id !== item.item_id);
  items.push(item);
  writeFileSync(ITEMS_FILE, `${JSON.stringify(items, null, 2)}\n`, {
    mode: 0o600,
  });
};

export const itemLabel = (item: StoredItem): string =>
  `${item.institution_name ?? item.institution_id ?? 'unknown'} (${item.item_id.slice(0, 8)})`;
