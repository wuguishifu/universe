# jankbot-gateway

The stateful half of jankbot: it holds a Discord gateway connection and that bot's voice
connections, so that [jankbot-core](../core) can be redeployed without the bot leaving voice. See
core's README for the full picture.

A Discord bot can only be in one voice channel per server, so jankbot runs one gateway per bot
("voice bot"), each with its own `DISCORD_TOKEN` and `NAME`. Exactly one has `ROLE=primary`: its bot
owns the slash commands. The rest are `ROLE=worker`.

What it does:

- **Voice**: joins and leaves channels when core sends a command on this bot's
  `voice-commands-<name>` queue, and captures each speaker's audio onto the `utterances` queue.
- **Heartbeat**: keeps `jankbot:voice-bots:<name>` (its name and Discord user ID) in Redis while
  running, so core knows the bot is online and which user it is.
- **Command routing** (primary only): every slash command is deferred and forwarded to core on the
  `interactions` queue, with the caller's current voice channel. core edits the reply.
- **Rejoining**: the channels the bot is in are kept in the Redis hash `jankbot:voice-sessions:<name>`. On
  start the gateway rejoins them, skipping any channel that has no one left in it. They're removed
  on `/leave`, when someone disconnects the bot or the channel is deleted, or when it auto-leaves,
  but not on shutdown.
- **Auto-leave**: after the bot has been alone in its channel (other bots don't count) for
  `VOICE_IDLE_TIMEOUT_MS` (default 5 minutes), it leaves.
- **Stall recovery**: if people have been speaking for `VOICE_RECEIVE_STALL_MS` (default 30s)
  without any audio getting through, it rejoins the channel. This happens when the connection's
  DAVE (end-to-end encryption) session gets stuck on a transition, which @discordjs/voice handles by
  silently dropping every packet. DAVE events and connection state changes are logged.

It doesn't register commands; core does that. Keep this service small, since every deploy of it
drops the bot from voice for a few seconds.

## Local development

1. Secrets in Infisical dev `/projects/jankbot/gateway`: `DISCORD_TOKEN` (the same bot as core) and `REDIS_URL` (the
   same Redis as core). Then `nx setup environment`. (Or use a gitignored `.env`; see `.env.example`.) Set
   `ROLE=primary` and a `NAME` that's in core's `VOICE_BOTS`.
2. `pnpm nx serve jankbot-gateway`, alongside `pnpm nx serve jankbot-core`.

To try more than one voice bot locally, run another gateway with a second bot's token, `ROLE=worker`, its own `NAME`
and `PORT`, and add the name to core's `VOICE_BOTS`. Each bot has to be invited to the server.

Only run one gateway per bot token: every gateway would receive every command.
