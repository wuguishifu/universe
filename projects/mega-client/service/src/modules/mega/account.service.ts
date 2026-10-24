import { Injectable } from '@nestjs/common';
import { type Account, parseWhoAmI } from '@projects/mega-client-contracts';
import { MegaCliError, MegaCliService } from './mega-cli.service';

/**
 * Re-read this often while polling, to notice the session ending (or the entrypoint's auto-login)
 * without a whoami every poll. Logging in or out here re-reads it straight away.
 */
const ACCOUNT_TTL_MS = 30_000;

/** Logging in fetches the account's whole file tree, which takes a while on a big account. */
const LOGIN_TIMEOUT_MS = 120_000;

@Injectable()
export class AccountService {
  private cached: { account: Account; readAt: number } | null = null;
  /** Bumped on login and logout, so a whoami that started before one doesn't get cached. */
  private generation = 0;

  constructor(private readonly megaCli: MegaCliService) {}

  public async get(): Promise<Account> {
    if (this.cached && Date.now() - this.cached.readAt < ACCOUNT_TTL_MS) {
      return this.cached.account;
    }
    const generation = this.generation;
    const account = await this.read();
    if (generation === this.generation) {
      this.cached = { account, readAt: Date.now() };
    }
    return account;
  }

  public async login({
    email,
    password,
    authCode,
  }: {
    email: string;
    password: string;
    authCode?: string;
  }): Promise<void> {
    try {
      await this.megaCli.run(
        [
          'login',
          ...(authCode ? [`--auth-code=${authCode}`] : []),
          // Ends the options, so a password starting with "-" isn't read as one.
          '--',
          email,
          password,
        ],
        { timeoutMs: LOGIN_TIMEOUT_MS },
      );
    } finally {
      this.forget();
    }
  }

  public async logout(): Promise<void> {
    try {
      await this.megaCli.run(['logout']);
    } finally {
      this.forget();
    }
  }

  private forget() {
    this.generation++;
    this.cached = null;
  }

  private async read(): Promise<Account> {
    try {
      const email = parseWhoAmI(await this.megaCli.run(['whoami']));
      return { loggedIn: true, email };
    } catch (error) {
      if (
        error instanceof MegaCliError &&
        /not logged in/i.test(error.message)
      ) {
        return { loggedIn: false, email: null };
      }
      throw error;
    }
  }
}
