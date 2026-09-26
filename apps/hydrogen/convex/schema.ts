import { defineSchema } from 'convex/server';
import { rubyTables } from './ruby/tables';
import { sapphireTables } from './sapphire/tables';
import { silverTables } from './silver/tables';

export default defineSchema({
  ...rubyTables,
  ...sapphireTables,
  ...silverTables,
});
