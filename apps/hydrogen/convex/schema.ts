import { defineSchema } from 'convex/server';
import { sapphireTables } from './sapphire/tables';
import { silverTables } from './silver/tables';

export default defineSchema({
  ...sapphireTables,
  ...silverTables,
});
