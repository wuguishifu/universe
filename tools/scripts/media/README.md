# media

Scripts for getting Medal clips to [clipper-service](../../../projects/clipper/service). They're
also the reference for the Windows client, which will do the same per clip.

## The proxy

Gemini sees about 1 frame a second at 66 tokens, whatever the resolution, so it's sent a small
copy of each clip instead of the original (100-250MB):

- 854×480 at most, 4fps (so runs can try `fps` up to 4), H.264 at ~400kbps, a keyframe every 2s
- every audio track (Medal can record game, mic and Discord separately) mixed to mono AAC at 64kbps
- the same timeline as the original, so Gemini's timestamps apply to it as they are
- under 18MB, since it's sent inline; long clips get a lower bitrate to fit

That's about 4MB for 2 minutes. It's named by the SHA-256 of the **original**, which is the clip's
identity in clipper. `PROXY` in [lib.mjs](lib.mjs) has the numbers.

## Scripts

Need Node 22+ and ffmpeg/ffprobe on `PATH` (or `FFMPEG_PATH`/`FFPROBE_PATH`). On a Mac they use
VideoToolbox; elsewhere libx264.

```sh
# one clip
node tools/scripts/media/make-proxy.mjs clip.mp4 proxy.mp4

# every clip under a folder: proxies/<sha256>.mp4 and manifest.jsonl in the out dir.
# Resumable. Clips in <clips>/<game>/ get that game; clips straight in <clips> get the one in
# their Medal file name.
node tools/scripts/media/proxy-backlog.mjs /Volumes/HDD/Medal/Clips ~/clipper-backlog

# upload them (S3 credentials from tools/scripts/s3/.env.local) and start a run. The API URL and
# token come from this folder's .env.local (nx setup environment), or --api-url/--token.
node tools/scripts/media/submit-backlog.mjs ~/clipper-backlog --sample 200 --label "defaults"
node tools/scripts/media/submit-backlog.mjs ~/clipper-backlog --sample 200 \
  --options '{"media":"audio","tailSeconds":45}' --label "audio, last 45s"

# wait for a run, cut what it found out of the originals, and write a page to watch them on
node tools/scripts/media/render-run.mjs ~/clipper-backlog <runId> --wait
open ~/clipper-backlog/renders/<runId>/index.html
```

Each `--sample` picks a different random set; to compare options on the same clips, start one run
and use `POST /api/runs/:id/rerun` with the other options. Without `--sample`, every clip in the
manifest is submitted (copies of a clip once).

## Tuning

`render-run.mjs` cuts each moment out of the original at 1080p (`--pad 1` adds a second either side,
as the client will) into `renders/<runId>/`, best first, and writes `index.html` with each one's
title, category, confidence and reasoning. Clips where nothing was found or that failed show their
proxy, so you can see what Gemini missed. Cuts already made are kept, so it's quick to rerun, e.g.
on a run that's still going. If the drive with the originals isn't plugged in, it cuts from the
proxies (480p, 4fps) and says so.
