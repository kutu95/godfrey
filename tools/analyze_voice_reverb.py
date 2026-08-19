"""Measure how 'roomy' a Godfrey voice sample is.

A dry studio voice drops into the noise floor within a few tens of milliseconds after each word;
a voice carrying room reverb (common when a cloned voice was trained on recordings made in a hall)
decays slowly and never reaches a low floor between words.

Usage:
  python tools/analyze_voice_reverb.py <file.wav> [more.wav ...]

Reads 16-bit PCM WAV only (what the exhibition pipeline streams). No third-party dependencies.
"""
from __future__ import annotations

import array
import sys
import wave
from math import log10

FRAME_MS = 10.0
# Decay is measured from "clearly speech" down to "clearly not speech", relative to the sample peak.
SPEECH_DB = -15.0
QUIET_DB = -35.0


def db(value: float, reference: float) -> float:
    if value <= 0.0 or reference <= 0.0:
        return -120.0
    return 20.0 * log10(value / reference)


def read_mono_frames(path: str):
    with wave.open(path, "rb") as handle:
        if handle.getsampwidth() != 2:
            raise SystemExit(f"{path}: expected 16-bit PCM, got {handle.getsampwidth() * 8}-bit")
        channels = handle.getnchannels()
        rate = handle.getframerate()
        raw = handle.readframes(handle.getnframes())

    samples = array.array("h")
    samples.frombytes(raw)
    if channels > 1:
        samples = array.array("h", (samples[i] for i in range(0, len(samples), channels)))

    frame_len = max(1, int(rate * FRAME_MS / 1000.0))
    frames = []
    for start in range(0, len(samples) - frame_len + 1, frame_len):
        total = 0
        for index in range(start, start + frame_len):
            value = samples[index]
            total += value * value
        frames.append((total / frame_len) ** 0.5)
    return frames, rate


def decay_times_ms(frames: list[float], peak: float) -> list[float]:
    """Time for each word ending to fall from SPEECH_DB to QUIET_DB."""
    times = []
    in_speech = False
    fell_at = None
    for index, value in enumerate(frames):
        level = db(value, peak)
        if level >= SPEECH_DB:
            in_speech = True
            fell_at = index
        elif in_speech and level <= QUIET_DB:
            if fell_at is not None:
                times.append((index - fell_at) * FRAME_MS)
            in_speech = False
            fell_at = None
    return times


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(len(ordered) * fraction))]


def analyse(path: str) -> None:
    frames, rate = read_mono_frames(path)
    if not frames:
        print(f"{path}: no audio")
        return

    peak = max(frames)
    levels = [db(value, peak) for value in frames]
    decays = decay_times_ms(frames, peak)
    speech_frames = [level for level in levels if level >= SPEECH_DB]

    median_decay = percentile(decays, 0.5) if decays else float("nan")
    long_decays = [d for d in decays if d >= 150.0]

    print(f"\n{path}")
    print(f"  duration            : {len(frames) * FRAME_MS / 1000.0:.2f}s @ {rate} Hz")
    print(f"  speech frames       : {len(speech_frames)} of {len(frames)}")
    print(f"  word endings found  : {len(decays)}")
    print(f"  median decay        : {median_decay:.0f} ms  (dry < 60, roomy > 150)")
    print(f"  slow decays (>150ms): {len(long_decays)} of {len(decays)}")
    print(f"  inter-word floor    : {percentile(levels, 0.10):.1f} dB below peak  (dry < -55, roomy > -35)")
    print(f"  quietest frame      : {min(levels):.1f} dB below peak")


def main() -> None:
    paths = sys.argv[1:]
    if not paths:
        raise SystemExit(__doc__)
    for path in paths:
        analyse(path)


if __name__ == "__main__":
    main()
