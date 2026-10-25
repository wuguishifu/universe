import { Injectable } from '@nestjs/common';
import { ConvexHttpClient } from 'convex/browser';
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from 'convex/server';

import { EnvironmentService } from '../../config/environment';

/** A convex notifications function guarded by NOTIFICATIONS_CONVEX_SECRET (platform/convex/app/convex/notifications/auth.ts). */
type NotificationsFunction<Type extends 'query' | 'mutation'> =
  FunctionReference<Type, 'public', { secret: string }>;
type NotificationsArgs<F extends NotificationsFunction<'query' | 'mutation'>> =
  Omit<FunctionArgs<F>, 'secret'>;

/** Convex client that attaches notifications-service's secret to every call. */
@Injectable()
export class ConvexService {
  private readonly client: ConvexHttpClient;
  private readonly secret: string;

  constructor(environmentService: EnvironmentService) {
    const { convexUrl, notificationsConvexSecret } =
      environmentService.environment;
    this.client = new ConvexHttpClient(convexUrl);
    this.secret = notificationsConvexSecret;
  }

  query<F extends NotificationsFunction<'query'>>(
    fn: F,
    args: NotificationsArgs<F>,
  ): Promise<FunctionReturnType<F>> {
    // Callers get full typing from the signature; the client's conditional rest-args types
    // can't be resolved against a generic F, so call it with the widened reference.
    const ref: FunctionReference<'query'> = fn;
    return this.client.query(ref, this.withSecret(args));
  }

  mutation<F extends NotificationsFunction<'mutation'>>(
    fn: F,
    args: NotificationsArgs<F>,
  ): Promise<FunctionReturnType<F>> {
    const ref: FunctionReference<'mutation'> = fn;
    return this.client.mutation(ref, this.withSecret(args));
  }

  private withSecret(args: object): Record<string, unknown> {
    return { ...args, secret: this.secret };
  }
}
