"""Prototype the reverb-tail suppressor before porting it to Unreal.

The exhibition voice carries room reverb that cannot be removed at the source. Most of what the ear
reads as 'hall' is the tail that keeps ringing after each word, so a downward expander that only acts
below speech level removes the impression without touching the words themselves.

Runs sample-by-sample with the same one-pole state a streaming C++ implementation would keep across
PCM chunks, so measurements here transfer to GodfreyPcmStreamSession.

Usage:
  python tools/dereverb_prototype.py <input.wav> [threshold_db ratio max_attenuation_db]
"""
from __future__ import annotations

import array
import sys
import wave
from math import log10
from pathlib import Path

from analyze_voice_reverb import FRAME_MS, db, decay_times_ms, percentile

# Envelope follower: quick enough to track a word onset, slow enough not to chase pitch periods.
ENV_ATTACK_MS = 3.0
ENV_RELEASE_MS = 60.0
# Gain smoothing: open instantly for speech, close gently so word tails are shortened, not chopped.
GAIN_OPEN_MS = 2.0
GAIN_CLOSE_MS = 45.0


def one_pole(time_ms: float, rate: int) -> float:
    if time_ms <= 0.0:
        return 0.0
    return pow(2.718281828459045, -1000.0 / (time_ms * rate))


def expand(samples: array.array, rate: int, threshold_db: float, ratio: float, max_attenuation_db: float):
    env_attack = one_pole(ENV_ATTACK_MS, rate)
    env_release = one_pole(ENV_RELEASE_MS, rate)
    gain_open = one_pole(GAIN_OPEN_MS, rate)
    gain_close = one_pole(GAIN_CLOSE_MS, rate)

    out = array.array("h", bytes(len(samples) * 2))
    envelope = 0.0
    gain = 1.0
    for index, raw in enumerate(samples):
        value = raw / 32768.0
        magnitude = value if value >= 0.0 else -value

        coeff = env_attack if magnitude > envelope else env_release
        envelope = coeff * envelope + (1.0 - coeff) * magnitude

        level_db = 20.0 * log10(envelope) if envelope > 1e-9 else -180.0
        if level_db < threshold_db:
            target_db = (level_db - threshold_db) * (ratio - 1.0)
            if target_db < -max_attenuation_db:
                target_db = -max_attenuation_db
            target = pow(10.0, target_db / 20.0)
        else:
            target = 1.0

        coeff = gain_close if target < gain else gain_open
        gain = coeff * gain + (1.0 - coeff) * target

        shaped = int(value * gain * 32768.0)
        out[index] = 32767 if shaped > 32767 else (-32768 if shaped < -32768 else shaped)
    return out


def frames_of(samples: array.array, rate: int) -> list[float]:
    frame_len = max(1, int(rate * FRAME_MS / 1000.0))
    frames = []
    for start in range(0, len(samples) - frame_len + 1, frame_len):
        total = 0
        for index in range(start, start + frame_len):
            value = samples[index]
            total += value * value
        frames.append((total / frame_len) ** 0.5)
    return frames


def report(label: str, samples: array.array, rate: int) -> None:
    frames = frames_of(samples, rate)
    peak = max(frames)
    levels = [db(value, peak) for value in frames]
    decays = decay_times_ms(frames, peak)
    median_decay = percentile(decays, 0.5) if decays else float("nan")
    print(
        f"  {label:<12} decay {median_decay:>4.0f} ms | endings {len(decays):>3} | "
        f"floor {percentile(levels, 0.10):>6.1f} dB | speech frames {sum(1 for l in levels if l >= -15.0):>4}"
    )


def main() -> None:
    args = sys.argv[1:]
    if not args:
        raise SystemExit(__doc__)
    path = Path(args[0])
    threshold_db = float(args[1]) if len(args) > 1 else -30.0
    ratio = float(args[2]) if len(args) > 2 else 2.5
    max_attenuation_db = float(args[3]) if len(args) > 3 else 18.0

    with wave.open(str(path), "rb") as handle:
        rate = handle.getframerate()
        channels = handle.getnchannels()
        raw = handle.readframes(handle.getnframes())
    samples = array.array("h")
    samples.frombytes(raw)
    if channels > 1:
        samples = array.array("h", (samples[i] for i in range(0, len(samples), channels)))

    processed = expand(samples, rate, threshold_db, ratio, max_attenuation_db)

    out_path = path.with_name(f"{path.stem}_expander_{threshold_db:g}_{ratio:g}_{max_attenuation_db:g}.wav")
    with wave.open(str(out_path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(processed.tobytes())

    print(f"\n{path.name}  threshold {threshold_db} dB, ratio {ratio}:1, max cut {max_attenuation_db} dB")
    report("before", samples, rate)
    report("after", processed, rate)
    print(f"  wrote {out_path}")


if __name__ == "__main__":
    main()
