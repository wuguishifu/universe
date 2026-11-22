import { defineSchema } from 'convex/server';

import { clipperTables } from './clipper/tables';
import { gameTables } from './game/tables';
import { notificationsTables } from './notifications/tables';
import { rubyTables } from './ruby/tables';
import { sapphireTables } from './sapphire/tables';

export default defineSchema({
  ...clipperTables,
  ...gameTables,
  ...notificationsTables,
  ...rubyTables,
  ...sapphireTables,
});
