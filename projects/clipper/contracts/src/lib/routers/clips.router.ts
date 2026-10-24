import { z } from 'zod';

import { MAX_CLIPS_PER_REQUEST, PROXY, sha256Schema } from '../clips';
import { c } from '../contract';

export const clipsRouter = c.router(
  {
    uploadUrls: {
      method: 'POST',
      path: '/upload-urls',
      description:
        "Presigned PUT URLs for clips' proxies. Proxies that are already uploaded get none.",
      body: z.object({
        clips: z
          .object({
            sha256: sha256Schema,
            /** The proxy's size. The URL only accepts exactly this many bytes. */
            sizeBytes: z.number().int().positive().max(PROXY.maxBytes),
          })
          .array()
          .min(1)
          .max(MAX_CLIPS_PER_REQUEST),
      }),
      responses: {
        200: z.object({
          bucket: z.string(),
          /** Upload with PUT, Content-Type PROXY.contentType and Content-Length sizeBytes. */
          uploads: z
            .object({
              sha256: z.string(),
              key: z.string(),
              /** Missing when the proxy is already uploaded. */
              uploadUrl: z.string().optional(),
            })
            .array(),
          expiresInSec: z.number(),
        }),
      },
    },
  },
  { pathPrefix: '/clips' },
);
