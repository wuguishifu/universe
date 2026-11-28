import { BullModule, getFlowProducerToken } from '@nestjs/bullmq';
import { DynamicModule, Module } from '@nestjs/common';
import type { FlowJob, FlowJobNode, FlowProducer, JobNode } from 'bullmq';

import type { QueueConfigMap, UniverseJobData } from '../common';

import { parseOrThrow } from './flow-service';
import { withIdempotencyKey } from './flow-tree';

export const UNIVERSE_FLOW_PRODUCER = 'universe-flow-producer';

/** The app's own job that runs once its children finish, typed by its queue config. */
export type FlowParentJob<C extends QueueConfigMap, K extends keyof C> = {
  queueConfig: C;
  queueKey: K;
  data: UniverseJobData<C, K>;
  /**
   * The queue's registered `defaultJobOptions` don't apply to jobs added through a flow, so pass
   * them here. Set the parent's ID with `addFlow`'s `idempotencyKey`.
   */
  opts?: Omit<NonNullable<FlowJob['opts']>, 'jobId'>;
  /** Defaults to the app's own Bull prefix (from `BullRootModule`). */
  prefix?: string;
};

/**
 * Adds flows of the app's own jobs with other services' jobs (from their clients) as children.
 * Inject it by class; `BullFlowModule` provides it.
 */
export class FlowClient {
  // Provided by a factory rather than `@InjectFlowProducer`: apps that typecheck this library
  // without legacy decorators (e.g. Next.js ones) would reject a parameter decorator.
  constructor(private readonly flowProducer: FlowProducer) {}

  /**
   * Runs `children` (and their own children), then `parent` in the app's own queue.
   *
   * @example
   * await flows.addFlow({
   *   idempotencyKey: clipId,
   *   parent: { queueConfig: MY_QUEUE_CONFIG, queueKey: 'publish', data: { clipId } },
   *   children: [
   *     transcription.child(
   *       { source: { type: 's3', bucket, key: audioKey } },
   *       { children: [ffmpeg.child(extractAudio)] },
   *     ),
   *   ],
   * });
   */
  public async addFlow<C extends QueueConfigMap, K extends keyof C>(
    flow: FlowSpec<C, K>,
  ): Promise<AddedFlow> {
    return toAddedFlow(await this.flowProducer.add(this.toFlowJob(flow)));
  }

  /**
   * Adds several flows in one round trip to Redis, e.g. one per item when queueing a backlog.
   * They're added atomically: if one is invalid, none are. Results are in the same order.
   *
   * A Redis transaction holds every job at once, so add a big backlog in chunks (a few hundred
   * flows at a time) rather than in one call.
   *
   * @throws if two flows share an `idempotencyKey`: their jobs would share IDs, so all but the
   * first would silently be dropped.
   */
  public async addFlows<C extends QueueConfigMap, K extends keyof C>(
    flows: FlowSpec<C, K>[],
  ): Promise<AddedFlow[]> {
    if (flows.length === 0) return [];
    const keys = new Set<string>();
    for (const { idempotencyKey } of flows) {
      if (idempotencyKey === undefined) continue;
      if (keys.has(idempotencyKey)) {
        throw new Error(
          `Two flows have idempotency key ${idempotencyKey}; only one of them would be added`,
        );
      }
      keys.add(idempotencyKey);
    }
    const jobs = flows.map((flow) => this.toFlowJob(flow));
    const nodes = await this.flowProducer.addBulk(jobs);
    return nodes.map(toAddedFlow);
  }

  private toFlowJob<C extends QueueConfigMap, K extends keyof C>({
    idempotencyKey,
    parent,
    children,
  }: FlowSpec<C, K>): FlowJob {
    const { queueConfig, queueKey, data, opts, prefix } = parent;
    const config = queueConfig[queueKey];
    if (!config) {
      throw new Error(`Unknown queue key: ${String(queueKey)}`);
    }
    if (children.length === 0) {
      throw new Error(
        'A flow needs at least one child; add the job to its queue instead',
      );
    }

    return withIdempotencyKey(
      {
        name: config.jobName,
        queueName: config.queueName,
        data: parseOrThrow(config.jobSchema, data, `${config.queueName} job`),
        opts,
        prefix,
        children,
      },
      idempotencyKey,
      // BullMQ's own default when the producer has no prefix.
      this.flowProducer.opts.prefix ?? 'bull',
    );
  }
}

/** One flow for `FlowClient.addFlow` or `addFlows`. */
export type FlowSpec<C extends QueueConfigMap, K extends keyof C> = {
  /**
   * Makes adding the flow again a no-op while its jobs are still in Redis (e.g. when the job
   * that adds it retries). Becomes the ID of every job in the flow that doesn't set its own
   * `jobId`, so it can't contain ':', and the flow can't have two jobs in the same queue.
   */
  idempotencyKey?: string;
  parent: FlowParentJob<C, K>;
  children: FlowJobNode[];
};

export type AddedFlow = { parentJobId: string; node: JobNode };

function toAddedFlow(node: JobNode): AddedFlow {
  // BullMQ types IDs as optional for jobs not yet added; flow jobs always have one.
  if (!node.job.id) {
    throw new Error('Flow was added without a parent job ID');
  }
  return { parentJobId: node.job.id, node };
}

/**
 * Provides `FlowClient` app-wide. Services' client modules import it, so apps don't need to.
 *
 * Needs the app's `BullRootModule`: the flow producer reuses its Redis connection (flows only work
 * when every queue in them is on the same Redis) and its prefix for the app's own parent jobs.
 */
@Module({})
export class BullFlowModule {
  private static instance?: DynamicModule;

  /** The same module every time, so importing it from several client modules registers it once. */
  public static forRoot(): DynamicModule {
    BullFlowModule.instance ??= {
      module: BullFlowModule,
      global: true,
      imports: [
        BullModule.registerFlowProducer({ name: UNIVERSE_FLOW_PRODUCER }),
      ],
      providers: [
        {
          provide: FlowClient,
          inject: [getFlowProducerToken(UNIVERSE_FLOW_PRODUCER)],
          useFactory: (flowProducer: FlowProducer) =>
            new FlowClient(flowProducer),
        },
      ],
      exports: [FlowClient],
    };
    return BullFlowModule.instance;
  }
}
