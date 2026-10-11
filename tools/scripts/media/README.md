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
# Resumable; the folder a clip is in is its game.
node tools/scripts/media/proxy-backlog.mjs /Volumes/HDD/Medal/Clips ~/clipper-backlog

# upload them (S3 credentials from tools/scripts/s3/.env.local) and start a run
export CLIPPER_API_URL=http://clipper-service:3008 CLIPPER_API_TOKEN=...
node tools/scripts/media/submit-backlog.mjs ~/clipper-backlog --sample 200 --label "defaults"
node tools/scripts/media/submit-backlog.mjs ~/clipper-backlog --sample 200 \
  --options '{"media":"audio","tailSeconds":45}' --label "audio, last 45s"
```

Each `--sample` picks a different random set; to compare options on the same clips, start one run
and use `POST /api/runs/:id/rerun` with the other options. Without `--sample`, every clip in the
manifest is submitted (copies of a clip once).
