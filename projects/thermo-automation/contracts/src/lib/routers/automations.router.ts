import { z } from 'zod';
import { automationInputSchema, automationSchema } from '../automations';
import { c } from '../contract';

const errorSchema = z.object({ message: z.string() });
const idParams = z.object({ id: z.coerce.number().int() });

/** Automations for the selected location. Temperatures are rounded to 0.5 °C on save. */
export const automationsRouter = c.router(
  {
    list: {
      method: 'GET',
      path: '',
      responses: { 200: automationSchema.array() },
    },
    create: {
      method: 'POST',
      path: '',
      body: automationInputSchema,
      responses: {
        201: automationSchema,
        400: errorSchema,
      },
    },
    update: {
      method: 'PUT',
      path: '/:id',
      pathParams: idParams,
      body: automationInputSchema,
      responses: {
        200: automationSchema,
        400: errorSchema,
        404: errorSchema,
      },
    },
    remove: {
      method: 'DELETE',
      path: '/:id',
      pathParams: idParams,
      body: c.noBody(),
      responses: {
        204: c.noBody(),
        404: errorSchema,
      },
    },
  },
  { pathPrefix: '/automations' },
);
