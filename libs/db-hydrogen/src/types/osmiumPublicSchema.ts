import { events } from '../db/schemas/osmium';

export type OsmiumPublicSchema = {
  Events: typeof events.$inferSelect;
};
