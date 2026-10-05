import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { Queue, QueueEvents } from 'bullmq';
import { createBullRootOptions } from '@libs/queue';
import {
  JANKBOT_QUEUE_PREFIX,
  VOICE_COMMANDS,
  type VoiceCommandJobData,
  type VoiceCommandResult,
  voiceBotId,
} from '@projects/jankbot-contracts';
import { EnvironmentService } from '../../environment/environment';

/** Joining waits up to 20s for the voice connection, so give the gateway a bit longer than that. */
const VOICE_COMMAND_TIMEOUT_MS = 30_000;

type VoiceBotQueue = {
  queue: Queue<VoiceCommandJobData, VoiceCommandResult>;
  events: QueueEvents;
};

/** Sends a join or leave to one voice bot's gateway and waits for the outcome. */
@Injectable()
export class VoiceCommandClient implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(VoiceCommandClient.name);
  private readonly queues = new Map<string, VoiceBotQueue>();

  constructor(private readonly environmentService: EnvironmentService) {}

  async onModuleInit() {
    const { redisUrl, voiceBots } = this.environmentService.environment;
    const options = createBullRootOptions(redisUrl, JANKBOT_QUEUE_PREFIX);
    for (const name of voiceBots) {
      const queueName = VOICE_COMMANDS.queueName(name);
      this.queues.set(voiceBotId(name), {
        queue: new Queue(queueName, {
          ...options,
          defaultJobOptions: {
            // Someone is waiting on the reply; they can run the command again instead.
            attempts: 1,
            removeOnComplete: { age: 60 * 60, count: 100 },
            removeOnFail: { age: 24 * 60 * 60, count: 100 },
          },
        }),
        events: new QueueEvents(queueName, options),
      });
    }
    await Promise.all(
      [...this.queues.values()].map(({ events }) => events.waitUntilReady()),
    );
  }

  async onApplicationShutdown() {
    await Promise.all(
      [...this.queues.values()].flatMap(({ queue, events }) => [
        queue.close(),
        events.close(),
      ]),
    );
  }

  /** Resolves to 'timeout' if the gateway didn't finish in time (e.g. it's down). */
  async send(
    botName: string,
    data: Omit<VoiceCommandJobData, 'expiresAt'>,
  ): Promise<VoiceCommandResult | 'timeout'> {
    const target = this.queues.get(voiceBotId(botName));
    if (!target) throw new Error(`Unknown voice bot: ${botName}`);

    const job = await target.queue.add(VOICE_COMMANDS.jobName, {
      ...data,
      expiresAt: Date.now() + VOICE_COMMAND_TIMEOUT_MS,
    });
    try {
      const result: unknown = await job.waitUntilFinished(
        target.events,
        VOICE_COMMAND_TIMEOUT_MS,
      );
      return VOICE_COMMANDS.resultSchema.parse(result);
    } catch (error) {
      if (!isTimeout(error)) throw error;
      this.logger.warn(
        `[${data.guildId}] ${botName} didn't answer ${data.command.action} in time`,
      );
      // If it's still waiting, nobody's going to pick it up in time; expiresAt covers the rest.
      await job.remove().catch(() => undefined);
      return 'timeout';
    }
  }
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.message.includes('timed out');
}
