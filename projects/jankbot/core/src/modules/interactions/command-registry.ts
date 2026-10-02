import { Injectable } from '@nestjs/common';
import { LeaderboardCommands } from '../leaderboard/leaderboard.commands';
import { TrackedWordsCommands } from '../tracked-words/tracked-words.commands';
import { type CommandHandler } from './command-handler';

/** core's commands. Adding one here registers it with Discord and routes it to its handler. */
@Injectable()
export class CommandRegistry {
  readonly handlers: readonly CommandHandler[];
  private readonly byName: ReadonlyMap<string, CommandHandler>;

  constructor(
    trackedWords: TrackedWordsCommands,
    leaderboard: LeaderboardCommands,
  ) {
    this.handlers = [trackedWords, leaderboard];
    this.byName = new Map(
      this.handlers.map((handler) => [handler.definition.name, handler]),
    );
  }

  find(name: string): CommandHandler | undefined {
    return this.byName.get(name);
  }
}
