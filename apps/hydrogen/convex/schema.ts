import { defineSchema } from 'convex/server';
import { rubyTables } from './ruby/tables';
import { sapphireTables } from './sapphire/tables';

export default defineSchema({
  ...rubyTables,
  ...sapphireTables,
});
