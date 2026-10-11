"""Speaker diarization with pyannote's community-1 pipeline.

Reads a 16 kHz mono 16-bit WAV (what transcription-worker's ffmpeg step writes) and writes who
spoke when as JSON: {"turns": [{"startMs", "endMs", "speaker"}]}. Turns can overlap when people
talk over each other. The model is loaded from a local directory, so nothing is downloaded and no
Hugging Face token is needed at runtime.
"""

import os

# Before pyannote is imported: no network calls, and no usage metrics.
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ["PYANNOTE_METRICS_ENABLED"] = "0"

import argparse
import json
import sys
import wave

import numpy as np


def read_wav(path: str) -> tuple[np.ndarray, int]:
    with wave.open(path, "rb") as wav:
        if wav.getnchannels() != 1 or wav.getsampwidth() != 2:
            raise ValueError(f"{path} must be mono 16-bit PCM")
        frames = wav.readframes(wav.getnframes())
        return np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768, wav.getframerate()


def pick_device(requested: str):
    import torch

    if requested != "auto":
        return torch.device(requested)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def main() -> None:
    parser = argparse.ArgumentParser(prog="diarize", description=__doc__.splitlines()[0])
    parser.add_argument("--model-dir", required=True, help="a local copy of pyannote/speaker-diarization-community-1")
    parser.add_argument("--input", required=True, help="16 kHz mono 16-bit WAV")
    parser.add_argument("--output", required=True, help="where to write the turns JSON")
    parser.add_argument("--min-speakers", type=int)
    parser.add_argument("--max-speakers", type=int)
    parser.add_argument("--device", default="auto", choices=["auto", "cuda", "mps", "cpu"])
    # 32 (pyannote's default) holds ~4.3 GB on Metal after the first run; 8 holds ~1.8 GB for ~10% more time.
    parser.add_argument("--batch-size", type=int, default=8)
    args = parser.parse_args()

    import torch
    from pyannote.audio import Pipeline

    pipeline = Pipeline.from_pretrained(args.model_dir)
    if pipeline is None:
        sys.exit(f"diarize: couldn't load a pipeline from {args.model_dir}")
    pipeline.to(pick_device(args.device))
    pipeline.embedding_batch_size = args.batch_size
    pipeline.segmentation_batch_size = args.batch_size

    audio, sample_rate = read_wav(args.input)
    speaker_counts = {
        key: value
        for key, value in {"min_speakers": args.min_speakers, "max_speakers": args.max_speakers}.items()
        if value is not None
    }
    output = pipeline({"waveform": torch.from_numpy(audio)[None], "sample_rate": sample_rate}, **speaker_counts)

    turns = [
        {"startMs": round(segment.start * 1000), "endMs": round(segment.end * 1000), "speaker": speaker}
        for segment, _, speaker in output.speaker_diarization.itertracks(yield_label=True)
    ]
    with open(args.output, "w") as file:
        json.dump({"turns": turns}, file)
