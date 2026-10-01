# ruby

Discord bot that sits in voice channels and keeps a leaderboard of who says tracked phrases
(like "I don't know") the most. Formerly the `discord-word-leaderboard` repo.

## How it works

```plaintext
Discord voice ──► VoiceSessionService (@discordjs/voice)
                    one subscription per speaker, ends after UTTERANCE_SILENCE_MS of silence
                    │
                    ▼  BullMQ "utterances" queue (raw Opus packets + utteranceId)
                  UtteranceProcessor
                    1. Opus ─► 16kHz mono WAV, in JS (audio.ts; no ffmpeg needed)
                    2. POST tungsten /api/transcriptions  (Idempotency-Key: ruby:<utteranceId>)
                    3. findPhraseMatches (@universe/phrase-matching)
                    4. api.ruby.counts.record (convex, via @universe/platform/convex/contracts)
```

- **Transcription** is [tungsten](../tungsten)'s job; ruby has no whisper or ffmpeg. Jobs retry on
  tungsten or Convex errors, and the idempotency key means a retry never transcribes twice.
- **Data** lives in [convex](../../platform/convex/app/convex/ruby/): `trackedPhrases` and `phraseCounts`.
  Every ruby function takes `RUBY_CONVEX_SECRET`, since the functions are public.
- The HTTP server only serves `/api/health` and `/api/version`.

## Commands

| Command                    | Notes                                                 |
| -------------------------- | ----------------------------------------------------- |
| `/join`                    | Joins the caller's voice channel and starts listening |
| `/leave`                   | Leaves the voice channel                              |
| `/words list\|add\|remove` | Manage tracked phrases (50 per server)                |
| `/leaderboard phrase:<..>` | Top speakers for a phrase                             |

## Local development

1. Secrets in Infisical dev `/ruby`: `DISCORD_TOKEN`, `DISCORD_DEV_GUILD_IDS`, `REDIS_URL`,
   `RUBY_CONVEX_SECRET`, `TUNGSTEN_URL`, `TUNGSTEN_API_TOKEN`. Then `nx setup environment`.
   (Or put them in a gitignored `apps/ruby/.env`; see `.env.example`.)
2. `RUBY_CONVEX_SECRET` must also be set on the convex deployment:
   `pnpm nx convex convex-app -- env set RUBY_CONVEX_SECRET <value>`.
3. `pnpm nx serve ruby`, then `/join` in a voice channel of a `DISCORD_DEV_GUILD_IDS` server.

Only run one instance per bot token: two processes would both answer every command.
