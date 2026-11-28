import { authTables } from '@convex-dev/auth/server';
import { defineSchema } from 'convex/server';

import { accessTables } from './access/tables';
import { albumTables } from './album/tables';
import { clipperTables } from './clipper/tables';
import { financeTables } from './finance/tables';
import { gameTables } from './game/tables';
import { notificationsTables } from './notifications/tables';
import { rubyTables } from './ruby/tables';
import { sapphireTables } from './sapphire/tables';

export default defineSchema({
  ...authTables,
  ...accessTables,
  ...albumTables,
  ...clipperTables,
  ...financeTables,
  ...gameTables,
  ...notificationsTables,
  ...rubyTables,
  ...sapphireTables,
});
