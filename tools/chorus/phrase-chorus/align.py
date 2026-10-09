"""Find each occurrence of a phrase and its onset: the DTW time of its first word, snapped to the energy rise after
the dip before it (or DTW - 100ms in connected speech, where DTW runs ~100ms late). usage: align.py <dir> "<phrase>"
"""
import json, sys, os, re, wave, array, math
root = sys.argv[1]
norm = lambda w: re.sub(r"[^a-z]", "", w.lower())
phrase = [norm(w) for w in sys.argv[2].split()]
FR = 160  # 10ms frames at 16kHz

def rms_frames(path):
    w = wave.open(path); a = array.array('h', w.readframes(w.getnframes()))
    return [math.sqrt(sum(x*x for x in a[i:i+FR]) / max(1, len(a[i:i+FR]))) for i in range(0, len(a), FR)]

def smooth(e, k=2):
    return [sum(e[max(0,i-k):i+k+1]) / len(e[max(0,i-k):i+k+1]) for i in range(len(e))]

out = []
for fn in sorted(os.listdir(f"{root}/jdtw")):
    uid = fn[:-5]
    toks = [t for s in json.load(open(f"{root}/jdtw/{fn}"))["transcription"] for t in s["tokens"] if not t["text"].startswith("[_")]
    words = []
    for t in toks:
        if t["text"].startswith(" ") or not words: words.append([t["text"].strip().lower(), t["t_dtw"]*10, t["offsets"]["from"]])
        else: words[-1][0] += t["text"].lower()
    words = [(norm(w), d, p) for w, d, p in words]
    words = [w for w in words if w[0]]
    e = smooth(rms_frames(f"{root}/wav/{uid}.wav"))
    for i in range(len(words) - len(phrase) + 1):
        if [w[0] for w in words[i:i + len(phrase)]] != phrase: continue
        dtw = words[i][1]; f = int(dtw // 10)
        lo = max(0, f - 20)
        dip = min(range(lo, f + 1), key=lambda j: e[j])
        peak = max(e[dip:min(len(e), f + 30)])
        thr = e[dip] + 0.15 * (peak - e[dip])
        snapped = e[dip] < 0.35 * peak
        onset = next(j for j in range(dip, len(e)) if e[j] >= thr) if snapped else max(0, f - 10)
        end = words[i + len(phrase) - 1][1] + 250  # roughly end of the last word
        out.append({"id": uid, "dtw": dtw, "plain": words[i][2], "onset": onset * 10, "snapped": snapped, "end": end})
        print(f"{uid[:8]} plain={words[i][2]:6} dtw={dtw:6.0f} onset={onset*10:6} {"snap" if snapped else "dtw-100"}")
json.dump(out, open(f"{root}/hits.json", "w"), indent=1)
