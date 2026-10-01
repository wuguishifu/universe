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
                    4. api.ruby.counts.record (hydrogen, via @universe/hydrogen-kore)
```

- **Transcription** is [tungsten](../tungsten)'s job; ruby has no whisper or ffmpeg. Jobs retry on
  tungsten or Convex errors, and the idempotency key means a retry never transcribes twice.
- **Data** lives in [hydrogen](../hydrogen/convex/ruby): `trackedPhrases` and `phraseCounts`.
  Every ruby function takes `RUBY_CONVEX_SECRET`, since the functions are public.
- The HTTP server serves `/api/health`, `/api/version`, and the live feed socket (below).

## Live feed

Ruby keeps the last 100 transcripts per server **in memory** (a restart clears them) and
streams them to [sapphire](../sapphire)'s `/ruby` page over a WebSocket at `/api/feed`:

```plaintext
browser ──(Clerk, Discord sign-in)──► sapphire server action
            signs a 60s ticket { discord user id } with RUBY_FEED_SECRET
browser ──wss://<ruby host>/api/feed?ticket=…──► FeedGateway
            verifies the ticket, then guild.members.fetch(user) on every server ruby is in
            sends { type: 'ready', guilds, utterances } then { type: 'utterance', … } live
```

- Viewers only get servers they're a member of, checked when they connect.
- Speaker names and avatars are server profiles, cached for 10 minutes.
- Behind a Cloudflare tunnel, `/api/feed` must not require a CF Access service token (the
  browser can't send one); the ticket is the auth. The socket pings every 30s to stay under
  Cloudflare's idle timeout.

## Commands

| Command                    | Notes                                                 |
| -------------------------- | ----------------------------------------------------- |
| `/join`                    | Joins the caller's voice channel and starts listening |
| `/leave`                   | Leaves the voice channel                              |
| `/words list\|add\|remove` | Manage tracked phrases (50 per server)                |
| `/leaderboard phrase:<..>` | Top speakers for a phrase                             |

## Local development

1. Secrets in Infisical dev `/ruby`: `DISCORD_TOKEN`, `DISCORD_DEV_GUILD_IDS`, `REDIS_URL`,
   `RUBY_CONVEX_SECRET`, `TUNGSTEN_URL`, `TUNGSTEN_API_TOKEN`, `RUBY_FEED_SECRET` (same value as
   sapphire's). Then `nx setup environment`.
   (Or put them in a gitignored `apps/ruby/.env`; see `.env.example`.)
2. `RUBY_CONVEX_SECRET` must also be set on the hydrogen deployment:
   `pnpm nx convex hydrogen -- env set RUBY_CONVEX_SECRET <value>`.
3. `pnpm nx serve ruby`, then `/join` in a voice channel of a `DISCORD_DEV_GUILD_IDS` server.

Only run one instance per bot token: two processes would both answer every command.
