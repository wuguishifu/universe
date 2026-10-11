import { z } from 'zod';
import { MAX_CLIP_DURATION_SEC, PROXY } from './clips';
import { CLIPPER_MODELS, DEFAULT_MODEL } from './pricing';

/**
 * How a run analyzes its clips. Everything has a default, and a run stores the options it was
 * created with after defaults are applied, so runs can be compared field by field.
 */
export const runOptionsSchema = z.object({
  model: z.enum(CLIPPER_MODELS).default(DEFAULT_MODEL),
  /** 'audio' sends only the soundtrack: game, mic and Discord, mixed. About a third of the tokens. */
  media: z.enum(['video', 'audio']).default('video'),
  /** Video only: tokens per frame (about 66 low, 258 medium and high). */
  mediaResolution: z.enum(['low', 'medium', 'high']).default('low'),
  /** Video only: frames per second Gemini looks at. Tokens grow with it. */
  fps: z.number().gt(0).max(PROXY.fps).default(1),
  /**
   * Only look at the last this-many seconds. Medal clips end shortly after the moment that made
   * someone press the hotkey, so this cuts tokens for little loss. Timestamps still come back on
   * the full clip's timeline.
   */
  tailSeconds: z.number().int().min(10).max(MAX_CLIP_DURATION_SEC).optional(),
  thinkingLevel: z.enum(['minimal', 'low', 'medium', 'high']).default('low'),
  /** Added to the prompt, for tuning what counts as a good moment. */
  instructions: z.string().trim().min(1).max(2000).optional(),
});
export type RunOptions = z.output<typeof runOptionsSchema>;
export type RunOptionsInput = z.input<typeof runOptionsSchema>;

/** 'auto' runs are the client's, one per new clip; they're analyzed before 'manual' ones. */
export const runSourceSchema = z.enum(['manual', 'auto']);
export type RunSource = z.infer<typeof runSourceSchema>;
