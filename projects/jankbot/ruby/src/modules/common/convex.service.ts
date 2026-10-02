import { Injectable } from '@nestjs/common';
import { ConvexHttpClient } from 'convex/browser';
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from 'convex/server';
import { EnvironmentService } from '../../environment/environment-service';

/** A convex ruby function guarded by RUBY_CONVEX_SECRET (platform/convex/convex-app/ruby/auth.ts). */
type RubyFunction<Type extends 'query' | 'mutation'> = FunctionReference<
  Type,
  'public',
  { secret: string }
>;
type RubyArgs<F extends RubyFunction<'query' | 'mutation'>> = Omit<
  FunctionArgs<F>,
  'secret'
>;

/** Convex client that attaches ruby's secret to every call. */
@Injectable()
export class ConvexService {
  private readonly client: ConvexHttpClient;
  private readonly secret: string;

  constructor(environmentService: EnvironmentService) {
    const { convexUrl, rubyConvexSecret } = environmentService.environment;
    this.client = new ConvexHttpClient(convexUrl);
    this.secret = rubyConvexSecret;
  }

  query<F extends RubyFunction<'query'>>(
    fn: F,
    args: RubyArgs<F>,
  ): Promise<FunctionReturnType<F>> {
    // Callers get full typing from the signature; the client's conditional rest-args types
    // can't be resolved against a generic F, so call it with the widened reference.
    const ref: FunctionReference<'query'> = fn;
    return this.client.query(ref, this.withSecret(args));
  }

  mutation<F extends RubyFunction<'mutation'>>(
    fn: F,
    args: RubyArgs<F>,
  ): Promise<FunctionReturnType<F>> {
    const ref: FunctionReference<'mutation'> = fn;
    return this.client.mutation(ref, this.withSecret(args));
  }

  private withSecret(args: object): Record<string, unknown> {
    return { ...args, secret: this.secret };
  }
}
