import { defineSchema } from 'convex/server';

import { albumTables } from './album/tables';
import { clipperTables } from './clipper/tables';
import { gameTables } from './game/tables';
import { notificationsTables } from './notifications/tables';
import { rubyTables } from './ruby/tables';
import { sapphireTables } from './sapphire/tables';

export default defineSchema({
  ...albumTables,
  ...clipperTables,
  ...gameTables,
  ...notificationsTables,
  ...rubyTables,
  ...sapphireTables,
});
