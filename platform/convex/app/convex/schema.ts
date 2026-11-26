import { authTables } from '@convex-dev/auth/server';
import { defineSchema } from 'convex/server';

import { clipperTables } from './clipper/tables';
import { financeTables } from './finance/tables';
import { gameTables } from './game/tables';
import { notificationsTables } from './notifications/tables';
import { rubyTables } from './ruby/tables';
import { sapphireTables } from './sapphire/tables';

export default defineSchema({
  ...authTables,
  ...clipperTables,
  ...financeTables,
  ...gameTables,
  ...notificationsTables,
  ...rubyTables,
  ...sapphireTables,
});
