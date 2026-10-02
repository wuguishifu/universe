# jankbot-core

The logic half of jankbot, a Discord bot that sits in voice channels and keeps a leaderboard of who
says tracked phrases (like "I don't know") the most. Formerly `ruby`, and before that the
`discord-word-leaderboard` repo.

jankbot is split so that deploying core never kicks the bot out of voice:

- **[jankbot-gateway](../gateway)** holds the Discord gateway connection and the voice connections.
  It handles `/join` and `/leave` itself, and only changes when voice handling does.
- **jankbot-core** (this) does the work: transcription, phrase matching, Convex, and every other
  command. It never connects to the Discord gateway; it talks to Discord over HTTP only.
- **[jankbot-contracts](../contracts)** holds what both share: the queue payloads and the command
  definitions.

## How it works

```plaintext
Discord voice ──► gateway: VoiceSessionService (@discordjs/voice)
                    one subscription per speaker, ends after UTTERANCE_SILENCE_MS of silence
                    │
                    ▼  BullMQ "utterances" queue (raw Opus packets + utteranceId)
                  core: UtteranceProcessor
                    1. Opus ─► 16kHz mono WAV, in JS (audio.ts; no ffmpeg needed)
                    2. POST transcription-service /api/transcriptions  (Idempotency-Key: jankbot:<utteranceId>)
                    3. findPhraseMatches (@libs/phrase-matching)
                    4. api.ruby.counts.record (convex, via @platform/convex-contracts)

Slash command ──► gateway: InteractionRouter
                    /join, /leave: handled in the gateway
                    anything else: deferReply(), then
                    │
                    ▼  BullMQ "interactions" queue (command, options, interaction token)
                  core: InteractionProcessor
                    runs the command, then edits the deferred reply through the interaction webhook
```

- While core is down or redeploying, utterances and commands wait in Redis. Commands show
  "thinking..." until core picks them up; interaction tokens last 15 minutes, so core gives up on
  (and reports) anything older than that.
- **Commands** are defined in `@projects/jankbot-contracts` and registered by core over REST on
  every start (in `DISCORD_DEV_GUILD_IDS` if set, otherwise globally). The gateway runs Necord with
  `skipRegistration` so it doesn't overwrite them. A new core command works without a gateway
  deploy; the gateway defers commands it doesn't know about publicly. Making a command ephemeral
  needs a gateway deploy, since the gateway decides that when it defers.
- **Transcription** is [transcription-service](../../../platform/transcription/service)'s job; core has no whisper or
  ffmpeg. Jobs retry on transcription-service or Convex errors, and the idempotency key means a retry never transcribes
  twice.
- **Data** lives in [convex](../../../platform/convex/app/convex/ruby/): `trackedPhrases` and `phraseCounts`.
  Every ruby function takes `RUBY_CONVEX_SECRET`, since the functions are public. (The Convex side still uses the
  `ruby` name.)
- The HTTP server only serves `/api/health` and `/api/version`.

## Commands

| Command                    | Handled by | Notes                                                 |
| -------------------------- | ---------- | ----------------------------------------------------- |
| `/join`                    | gateway    | Joins the caller's voice channel and starts listening |
| `/leave`                   | gateway    | Leaves the voice channel                              |
| `/words list\|add\|remove` | core       | Manage tracked phrases (50 per server)                |
| `/leaderboard phrase:<..>` | core       | Top speakers for a phrase                             |

## Local development

1. Secrets in Infisical dev `/projects/jankbot/ruby` (still the old path; see `infisicalPath` in
   `platform/environment/config.json`): `DISCORD_TOKEN`, `DISCORD_DEV_GUILD_IDS`, `REDIS_URL`,
   `RUBY_CONVEX_SECRET`, `TRANSCRIPTION_SERVICE_URL`, `TRANSCRIPTION_SERVICE_API_TOKEN`. Then `nx setup environment`.
   (Or put them in a gitignored `projects/jankbot/core/.env`; see `.env.example`.)
2. `RUBY_CONVEX_SECRET` must also be set on the convex deployment:
   `pnpm nx convex convex-app -- env set RUBY_CONVEX_SECRET <value>`.
3. `pnpm nx serve jankbot-core` and `pnpm nx serve jankbot-gateway` (same `REDIS_URL` and bot token), then `/join` in
   a voice channel of a `DISCORD_DEV_GUILD_IDS` server.

core can run as many instances as you like. Only run one gateway per bot token: every gateway would
receive every command.
