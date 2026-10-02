# jankbot-gateway

The stateful half of jankbot: it holds the Discord gateway connection and the bot's voice
connections, so that [jankbot-core](../core) can be redeployed without the bot leaving voice. See
core's README for the full picture.

What it does:

- **Voice**: `/join` and `/leave`, and capturing each speaker's audio onto the `utterances` queue.
- **Command routing**: every other slash command is deferred and forwarded to core on the
  `interactions` queue. core edits the reply.
- **Rejoining**: the channels the bot is in are kept in the Redis hash `jankbot:voice-sessions`. On
  start the gateway rejoins them, skipping any channel that has no one left in it. They're removed
  on `/leave`, when the bot is kicked or the channel is deleted, or when it auto-leaves, but not on
  shutdown.
- **Auto-leave**: after the bot has been alone in its channel (other bots don't count) for
  `VOICE_IDLE_TIMEOUT_MS` (default 5 minutes), it leaves.

It doesn't register commands; core does that. Keep this service small, since every deploy of it
drops the bot from voice for a few seconds.

## Local development

1. Secrets in Infisical dev `/projects/jankbot/gateway`: `DISCORD_TOKEN` (the same bot as core) and `REDIS_URL` (the
   same Redis as core). Then `nx setup environment`. (Or use a gitignored `.env`; see `.env.example`.)
2. `pnpm nx serve jankbot-gateway`, alongside `pnpm nx serve jankbot-core`.

Only run one gateway per bot token: every gateway would receive every command.
