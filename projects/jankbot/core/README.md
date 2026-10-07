# jankbot-core

The logic half of jankbot, a Discord bot that sits in voice channels and keeps a leaderboard of who
says tracked phrases (like "I don't know") the most. Formerly `ruby`, and before that the
`discord-word-leaderboard` repo.

jankbot is split so that deploying core never kicks the bot out of voice:

- **[jankbot-gateway](../gateway)** holds the Discord gateway connection and the voice connections.
  One runs per voice bot (a bot can only be in one voice channel per server, so more bots means more
  channels at once). The primary one receives every slash command and forwards it here. It only
  changes when voice handling does.
- **jankbot-core** (this) does the work: transcription, phrase matching, Convex, and every other
  command. It never connects to the Discord gateway; it talks to Discord over HTTP only.
- **[jankbot-contracts](../contracts)** holds what both share: the queue payloads and Redis keys.

## How it works

```plaintext
Discord voice ──► gateway: VoiceSessionService (@discordjs/voice)
                    one subscription per speaker, ends after UTTERANCE_SILENCE_MS of silence
                    │
                    ▼  BullMQ "utterances" queue (raw Opus packets + utteranceId)
                  core: UtteranceProcessor
                    1. Opus ─► 16kHz mono WAV, in JS (audio.ts; no ffmpeg needed)
                    2. add a BullMQ flow (@platform/transcription-client-nest, keyed by utteranceId)
                    │
                    ▼  child: transcription worker's queue (WAV + vocabulary prompt)
                  transcription worker: whisper
                    │
                    ▼  parent: "transcribed-utterances" queue, runs once the transcript is ready
                  core: TranscribedUtteranceProcessor
                    1. findPhraseMatches (@libs/phrase-matching)
                    2. api.ruby.counts.record (convex, via @platform/convex-contracts)

Slash command ──► primary gateway: InteractionRouter
                    deferReply(), then
                    │
                    ▼  BullMQ "interactions" queue (command, options, caller's voice channel, interaction token)
                  core: InteractionProcessor
                    runs the command, then edits the deferred reply through the interaction webhook
                    │
                    ▼  /join, /leave: BullMQ "voice-commands-<name>" queue, one per voice bot
                  that bot's gateway: VoiceCommandWorker joins or leaves, and core waits for the result
```

- While core is down or redeploying, utterances and commands wait in Redis. Commands show
  "thinking..." until core picks them up; interaction tokens last 15 minutes, so core gives up on
  (and reports) anything older than that.
- **Commands** are defined in core and registered on the primary bot (`DISCORD_TOKEN`) over REST on
  every start (in `DISCORD_DEV_GUILD_IDS` if set, otherwise globally). The gateways run Necord with
  `skipRegistration` so they don't overwrite them. A new core command works without a gateway
  deploy; the gateway defers commands it doesn't know about publicly. Making a command ephemeral
  needs a gateway deploy, since the gateway decides that when it defers.
- **Transcription** is the [transcription worker](../../../platform/transcription/worker)'s job; core has no whisper
  or ffmpeg. core hands it work through Redis as a [flow](../../../platform/transcription/client-nest), so the worker
  must use the same `REDIS_URL`. Transcripts aren't needed in real time: when the worker falls behind, utterances wait
  in its queue. Flows are keyed by `utteranceId`, so a retried utterance job never transcribes twice, and a retried
  `transcribed-utterances` job reuses the stored transcript. A failed transcription is logged and tracked, then
  skipped.
- **Data** lives in [convex](../../../platform/convex/app/convex/ruby/): `trackedPhrases` and `phraseCounts`.
  Every ruby function takes `RUBY_CONVEX_SECRET`, since the functions are public. (The Convex side still uses the
  `ruby` name.)
- The HTTP server only serves `/api/health` and `/api/version`.

## Commands

| Command                    | Handled by | Notes                                                 |
| -------------------------- | ---------- | ----------------------------------------------------- |
| `/join [bot]`              | core       | Sends a voice bot to the caller's voice channel       |
| `/leave [bot]`             | core       | Disconnects the named bot, or the one in your channel |
| `/words list\|add\|remove` | core       | Manage tracked phrases (50 per server)                |
| `/leaderboard phrase:<..>` | core       | Top speakers for a phrase                             |

## Voice bots

`VOICE_BOTS` (e.g. `Bo,Mikey,Steven`) lists the voice bots by each gateway's `NAME`; they're also the choices for the
`bot` option. For every `/join` and `/leave`, core looks each bot up fresh: online if its gateway's heartbeat is in
Redis, then its guild membership and voice state from Discord's API. Nothing about where bots are is cached.

- `/join` without `bot` sends the first free bot in `VOICE_BOTS` order. A short Redis claim per bot and guild keeps two
  `/join`s at once from picking the same one. With `bot`, it's that bot or an error (offline, not in this server, or
  already in a channel).
- `/leave` without `bot` disconnects whichever bot is in the caller's voice channel.
- Every bot has to be invited to each server separately. Only the primary bot needs the commands scope.

## Local development

1. Secrets in Infisical dev `/projects/jankbot/core` (see `secretsPaths` in `environment-config.json`):
   `DISCORD_TOKEN`, `DISCORD_DEV_GUILD_IDS`, `REDIS_URL`, `RUBY_CONVEX_SECRET`. Then `nx setup environment`.
   (Or put them in a gitignored `projects/jankbot/core/.env`; see `.env.example`.)
2. `RUBY_CONVEX_SECRET` must also be set on the convex deployment:
   `pnpm nx convex convex-app -- env set RUBY_CONVEX_SECRET <value>`.
3. `pnpm nx serve jankbot-core`, `pnpm nx serve jankbot-gateway` and `pnpm nx serve transcription-worker` (all on the
   same `REDIS_URL`; core and gateway on the same bot token), then `/join` in a voice channel of a
   `DISCORD_DEV_GUILD_IDS` server.

core can run as many instances as you like. Only run one gateway per bot token: every gateway would
receive every command.
