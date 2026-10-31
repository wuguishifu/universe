import { initClient } from '@ts-rest/core';
import { z } from 'zod';

import { type McpToolset, toolResult } from '@platform/mcp-toolkit';
import {
  isMegaLink,
  megaRootRouter,
  TransferState,
} from '@projects/mega-client-contracts';

export type MegaToolsetOptions = {
  /** mega-client-service's origin. The contract adds `/api`. */
  baseUrl: string;
};

const SNAPSHOT =
  'Answers with the snapshot afterwards, as mega_get_status does.';

const tag = z
  .string()
  .regex(/^\d+$/, 'Not a transfer tag')
  .describe("A transfer's `tag` from mega_get_status.");

/** mega-client's MEGA downloads, through its API. */
export function createMegaToolset({ baseUrl }: MegaToolsetOptions): McpToolset {
  const api = initClient(megaRootRouter, { baseUrl });

  return {
    name: 'mega-client',
    register: (server) => {
      server.registerTool(
        'mega_get_status',
        {
          title: 'Get MEGA download status',
          description:
            'What the MEGA downloader on the home server is doing. It returns:\n' +
            '- `account`: whether it is logged in to MEGA. Only a person can sign it in, from the ' +
            'mega-client web app, so if it is logged out, ask them to.\n' +
            '- `transfers`: unfinished transfers in queue order, then the 10 most recently ' +
            'finished. Each has a `tag` (the other tools take it), `name`, `destinationPath` ' +
            '(where the file or folder lands on the server), `state`, `percent`, `totalBytes`, ' +
            '`bytesPerSecond` and `etaSeconds`. Speed and ETA are null until the downloader has ' +
            'read a transfer a few times, so they can be null on the first call.\n' +
            `- \`state\` is one of ${Object.values(TransferState).join(', ')}. ` +
            '`heldByQueue` means it is held by "pause all" whatever its state says.\n' +
            '- `queuePaused`: "pause all" is on. MEGA only reports it while some transfer is ' +
            'listed, so with no transfers at all it reads false even when paused, and anything ' +
            'queued then will wait (`heldByQueue`) until mega_resume_all.\n' +
            "- `error`: why the downloader's last read failed. If it is set, the rest is from " +
            'the read before.\n' +
            'Call this again to follow a download: there are no notifications.',
          annotations: { readOnlyHint: true },
        },
        () => toolResult(api.snapshot(), 200),
      );

      server.registerTool(
        'mega_queue_downloads',
        {
          title: 'Download MEGA links',
          description:
            "Download MEGA links (https://mega.nz/file/... or /folder/...) into the server's " +
            'download folder, queued in the order given. A folder link downloads as a folder ' +
            'with its contents. If MEGA refuses a link, the links after it are not queued; the ' +
            'ones before it already are. If the new transfers come back with `heldByQueue`, ' +
            `"pause all" is on and mega_resume_all starts them. ${SNAPSHOT}`,
          inputSchema: z.object({
            urls: z
              .array(z.string().trim().refine(isMegaLink, 'Not a MEGA link'))
              .min(1)
              .describe('Full links, including the key after `#`.'),
          }),
        },
        ({ urls }) => toolResult(api.transfers.queue({ body: { urls } }), 200),
      );

      server.registerTool(
        'mega_pause_transfer',
        {
          title: 'Pause a MEGA transfer',
          description: `Pause one transfer until mega_resume_transfer. ${SNAPSHOT}`,
          inputSchema: z.object({ tag }),
          annotations: { idempotentHint: true },
        },
        ({ tag }) => toolResult(api.transfers.pause({ params: { tag } }), 200),
      );

      server.registerTool(
        'mega_resume_transfer',
        {
          title: 'Resume a MEGA transfer',
          description:
            'Resume a transfer paused with mega_pause_transfer. A transfer held by "pause all" ' +
            `(\`heldByQueue\`) only moves again after mega_resume_all. ${SNAPSHOT}`,
          inputSchema: z.object({ tag }),
          annotations: { idempotentHint: true },
        },
        ({ tag }) => toolResult(api.transfers.resume({ params: { tag } }), 200),
      );

      server.registerTool(
        'mega_cancel_transfer',
        {
          title: 'Cancel a MEGA transfer',
          description:
            'Cancel a transfer. It cannot be resumed afterwards: queue the link again to start ' +
            `over. ${SNAPSHOT}`,
          inputSchema: z.object({ tag }),
          annotations: { destructiveHint: true, idempotentHint: true },
        },
        ({ tag }) => toolResult(api.transfers.cancel({ params: { tag } }), 200),
      );

      server.registerTool(
        'mega_pause_all',
        {
          title: 'Pause all MEGA transfers',
          description:
            'Pause the whole queue, including anything queued afterwards, until mega_resume_all. ' +
            `States stay ACTIVE or QUEUED, with \`heldByQueue\` set. ${SNAPSHOT}`,
          annotations: { idempotentHint: true },
        },
        () => toolResult(api.transfers.pauseAll(), 200),
      );

      server.registerTool(
        'mega_resume_all',
        {
          title: 'Resume all MEGA transfers',
          description:
            'Lift "pause all", and resume every transfer that was paused on its own as well. ' +
            SNAPSHOT,
          annotations: { idempotentHint: true },
        },
        () => toolResult(api.transfers.resumeAll(), 200),
      );

      server.registerTool(
        'mega_cancel_all',
        {
          title: 'Cancel all MEGA transfers',
          description:
            'Cancel every download and upload. They cannot be resumed afterwards. Syncs are ' +
            `left alone. ${SNAPSHOT}`,
          annotations: { destructiveHint: true, idempotentHint: true },
        },
        () => toolResult(api.transfers.cancelAll(), 200),
      );
    },
  };
}
