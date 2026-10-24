import { Injectable } from '@nestjs/common';

import {
  OptInCommand,
  OptOutCommand,
} from '../compilation-opt-outs/compilation-opt-outs.commands';
import { LeaderboardCommands } from '../leaderboard/leaderboard.commands';
import { TrackedWordsCommands } from '../tracked-words/tracked-words.commands';
import { JoinCommand, LeaveCommand } from '../voice/voice.commands';

import { type CommandHandler } from './command-handler';

/** Every jankbot command. Adding one here registers it with Discord and routes it to its handler. */
@Injectable()
export class CommandRegistry {
  readonly handlers: readonly CommandHandler[];
  private readonly byName: ReadonlyMap<string, CommandHandler>;

  constructor(
    trackedWords: TrackedWordsCommands,
    leaderboard: LeaderboardCommands,
    join: JoinCommand,
    leave: LeaveCommand,
    optOut: OptOutCommand,
    optIn: OptInCommand,
  ) {
    this.handlers = [join, leave, trackedWords, leaderboard, optOut, optIn];
    this.byName = new Map(
      this.handlers.map((handler) => [handler.definition.name, handler]),
    );
  }

  find(name: string): CommandHandler | undefined {
    return this.byName.get(name);
  }
}
