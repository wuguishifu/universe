# phrase-chorus

Overlays every recording of a phrase so the phrase itself lands at the same instant (lead-ins play before it).

One folder per phrase: `wav/` (`utterances/<session>/<time>-<id>.wav`, or `utterances/<id>.wav` for
older ones, from the jankbot-recordings bucket), `jdtw/` (whisper output),
`hits.json` (onsets), `chorus-{full,tight}.{wav,mp3}`.

```sh
./transcribe.sh thats-crazy                      # whisper + DTW token timestamps -> jdtw/
python3 align.py thats-crazy "that's crazy"      # find the phrase, snap its onset -> hits.json
python3 mix.py thats-crazy thats-crazy/chorus-full.wav             # uncut lead-ins / tails
python3 mix.py thats-crazy thats-crazy/chorus-tight.wav 4000 3000  # at most 4s before / 3s after, faded
```

Notes:

- The `clips` timings in jankbot.recordings aren't used: some are zero-length or the whole segment.
- Plain whisper word times were off by up to ~600ms; DTW (needs `-nfa`) runs ~100ms late but is consistent, so
  align.py snaps to the energy rise after the dip before the first word, or uses DTW - 100ms when there's no dip.
- mix.py gains each track so the phrase (not the lead-in) is at a similar loudness, then amix + limiter.
- Fetching wavs isn't scripted (no aws cli here); they were pulled via presigned URLs.
