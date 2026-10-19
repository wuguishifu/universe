# youtube-music-service

The server half of youtube-music: it downloads the audio of YouTube videos with yt-dlp, keeps it in
S3, and serves the library, playlists and audio to the [mobile app](../mobile).

## How it works

```plaintext
app shares a link ─► POST /api/imports
                        video:    a row in music.tracks (status queued) ─► download queue
                        playlist: yt-dlp --flat-playlist, a row in music.playlists, a track per video

DownloadProcessor (bullmq, DOWNLOAD_CONCURRENCY at once)
  1. yt-dlp -J               ─► title/artist/album filled in right away (status downloading)
  2. yt-dlp --load-info-json ─► best audio as m4a (AAC; converted only if YouTube has no AAC) + thumbnail
  3. ffmpeg                  ─► thumbnail cropped to a 600×600 square, EBU R128 loudness measured
  4. S3 tracks/<youtube id>/{audio.m4a,artwork.jpg} ─► status ready

app ─► GET /api/tracks/:id/audio (Range requests passed through to S3, so seeking works)
```

- **Metadata**: official uploads ("Topic" channels) come with title, artists and album. For anything
  else, "Artist - Song (Official Video)" is split up and cleaned, and the channel stands in for the
  artist. Titles edited in the app are kept if the track is downloaded again.
- **Failures** are retried with backoff (4 attempts), except ones that can't get better (private,
  removed, age-restricted, live). The error shows in the app, which can retry it.
- **Re-sharing** a video that's already there returns it; a failed one is queued again. Re-sharing a
  playlist syncs it: videos added on YouTube since are added. Videos removed on YouTube stay.
- **Startup** queues any track that's still queued or downloading, in case Redis lost its jobs.
- **Loudness** is measured, not applied: the app turns loud tracks down if "Even out volume" is on.

Everything but `/api/health` needs `Authorization: Bearer <API_TOKEN>`. The audio and artwork routes
also take `?token=`, since the iOS lock screen fetches artwork without headers.

## Development

1. `nx setup environment` writes `.env.local` (see [.env.example](.env.example)). The
   `projects/youtube-music/service` Infisical path needs `API_TOKEN`.
1. Apply the `music` migration to your local DB: `nx migrate:run postgres-utils`.
1. Install yt-dlp and ffmpeg (`brew install yt-dlp ffmpeg`).
1. Create the bucket (`MUSIC_S3_BUCKET`, default `youtube-music`).
1. `nx serve youtube-music-service` (port 3010).

Tests: `nx test youtube-music-service` (metadata cleanup) and `nx test youtube-music-contracts` (link
parsing).

## Deploying

The image doesn't include yt-dlp or ffmpeg, so yt-dlp can be updated without a new image (YouTube
breaks old versions every so often). Mount Linux builds and point at them:

- yt-dlp: the standalone `yt-dlp_linux` (or `yt-dlp_linux_aarch64`) release; the image is Debian
  (glibc) and has no Python, so the zipapp won't run. yt-dlp uses the Node running the service as its
  JavaScript runtime.
- ffmpeg: a static build with the `ebur128` filter (any full build has it).

```yaml
env:
  - { name: YTDLP_PATH, value: /opt/bin/yt-dlp }
  - { name: FFMPEG_PATH, value: /opt/bin/ffmpeg }
```

Apply the `music` migration (the `universe-db-migrations` job) before the first deploy. The app needs
to reach the service; S3 doesn't have to be reachable from the phone, since audio is streamed through
the service.
