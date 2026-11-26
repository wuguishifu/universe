import { Injectable } from '@nestjs/common';
import { ConvexHttpClient } from 'convex/browser';
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from 'convex/server';
import { ConvexError } from 'convex/values';

import { EnvironmentService } from '../../config/environment';

/** A convex finance function guarded by FINANCE_CONVEX_SECRET (platform/convex/app/convex/finance/auth.ts). */
type FinanceFunction<Type extends 'query' | 'mutation'> = FunctionReference<
  Type,
  'public',
  { secret: string }
>;
type FinanceArgs<F extends FinanceFunction<'query' | 'mutation'>> = Omit<
  FunctionArgs<F>,
  'secret'
>;

/** Convex client that attaches finance's secret to every call. */
@Injectable()
export class ConvexService {
  private readonly client: ConvexHttpClient;
  private readonly secret: string;

  constructor(environmentService: EnvironmentService) {
    const { convexUrl, financeConvexSecret } = environmentService.environment;
    this.client = new ConvexHttpClient(convexUrl);
    this.secret = financeConvexSecret;
  }

  query<F extends FinanceFunction<'query'>>(
    fn: F,
    args: FinanceArgs<F>,
  ): Promise<FunctionReturnType<F>> {
    // Callers get full typing from the signature; the client's conditional rest-args types
    // can't be resolved against a generic F, so call it with the widened reference.
    const ref: FunctionReference<'query'> = fn;
    return this.client.query(ref, this.withSecret(args));
  }

  mutation<F extends FinanceFunction<'mutation'>>(
    fn: F,
    args: FinanceArgs<F>,
  ): Promise<FunctionReturnType<F>> {
    const ref: FunctionReference<'mutation'> = fn;
    return this.client.mutation(ref, this.withSecret(args));
  }

  private withSecret(args: object): Record<string, unknown> {
    return { ...args, secret: this.secret };
  }
}

/** The `code` of a ConvexError thrown as `new ConvexError({ code })`, if that's what this is. */
export function convexErrorCode(error: unknown): string | undefined {
  if (!(error instanceof ConvexError)) return undefined;
  const data: unknown = error.data;
  return typeof data === 'object' && data && 'code' in data
    ? String(data.code)
    : undefined;
}
