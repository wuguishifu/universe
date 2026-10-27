import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createHash, timingSafeEqual } from 'crypto';

import {
  idempotencyKeySchema,
  notificationSchema,
} from '@platform/notifications-contracts';

import { notifications } from '../../../modules/notifications/notifications-client';
import { requireEnv } from '../../../modules/server-env';

const bodySchema = notificationSchema.extend({
  idempotencyKey: idempotencyKeySchema.optional(),
});

/**
 * Queues a notification for every sapphire-mobile device that hasn't muted its channel, for callers
 * that can't reach notifications-service on the tailnet (e.g. the sapphire-mobile EAS workflow).
 * Takes the same body as notifications-service's POST /api/notifications, minus `source`, with
 * `Authorization: Bearer <API_TOKEN>`.
 */
export async function POST(request: NextRequest) {
  if (!isAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { message: z.prettifyError(parsed.error) },
      { status: 400 },
    );
  }
  const { idempotencyKey, ...notification } = parsed.data;

  try {
    const { jobId } = await notifications.send(notification, {
      idempotencyKey,
    });
    return NextResponse.json({ jobId }, { status: 202 });
  } catch (error) {
    // Only the message: an axios error carries the request's headers, tokens included.
    // eslint-disable-next-line no-console
    console.error(
      "Couldn't queue notification:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { message: "Couldn't reach notifications-service" },
      { status: 502 },
    );
  }
}

function isAuthorized(header: string | null): boolean {
  const token = header?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return false;
  // Hashed first so both sides are the same length, which timingSafeEqual needs.
  return timingSafeEqual(sha256(token), sha256(requireEnv('API_TOKEN')));
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
