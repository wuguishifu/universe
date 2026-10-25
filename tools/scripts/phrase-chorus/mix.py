"""Overlay every phrase occurrence (from align.py) so the phrase lands at the same instant. usage: mix.py root out.wav [max_pre_ms max_post_ms]"""
import json, sys, wave, array, math, subprocess
root, out = sys.argv[1], sys.argv[2]
max_pre = float(sys.argv[3]) if len(sys.argv) > 3 else 1e9
max_post = float(sys.argv[4]) if len(sys.argv) > 4 else 1e9
hits = json.load(open(f"{root}/hits.json"))

def load(uid):
    w = wave.open(f"{root}/wav/{uid}.wav"); return array.array('h', w.readframes(w.getnframes()))

tracks = []
for h in hits:
    a = load(h["id"]); dur = len(a) / 16
    start = max(0, h["onset"] - max_pre); end = min(dur, h["onset"] + max_post)
    # loudness of the phrase itself (onset .. end of "know"), so each person's phrase hits equally hard
    seg = a[int(h["onset"] * 16):int(min(h["end"], dur) * 16)] or a
    rms = math.sqrt(sum(x * x for x in seg) / len(seg)) or 1
    gain = min(8.0, 3000 / rms)
    tracks.append(dict(h, start=start, end=end, pre=h["onset"] - start, gain=gain, dur=dur))

lead = max(t["pre"] for t in tracks)
args, filters = ["ffmpeg", "-y", "-loglevel", "error"], []
for i, t in enumerate(tracks):
    args += ["-i", f"{root}/wav/{t['id']}.wav"]
    length = (t["end"] - t["start"]) / 1000
    fade = []
    if t["start"] > 0: fade.append(f"afade=t=in:d=0.3")
    if t["end"] < t["dur"]: fade.append(f"afade=t=out:st={max(0, length - 0.3):.3f}:d=0.3")
    chain = [f"atrim=start={t['start']/1000:.3f}:end={t['end']/1000:.3f}", "asetpts=PTS-STARTPTS",
             f"volume={t['gain']:.3f}", *fade, f"adelay={lead - t['pre']:.0f}"]
    filters.append(f"[{i}:a]{','.join(chain)}[t{i}]")
n = len(tracks)
filters.append("".join(f"[t{i}]" for i in range(n)) + f"amix=inputs={n}:normalize=0:dropout_transition=0,volume={1/math.sqrt(n):.3f},alimiter=limit=0.9[out]")
args += ["-filter_complex", ";".join(filters), "-map", "[out]", "-ar", "48000", out]
subprocess.run(args, check=True)
print(f"{n} tracks, phrase lands at {lead/1000:.2f}s -> {out}")
