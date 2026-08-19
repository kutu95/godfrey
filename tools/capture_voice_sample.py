"""Capture a short ElevenLabs sample as 16-bit WAV for offline inspection.

Isolates whether a 'roomy' quality comes from the voice itself or from the voice_settings, by
letting each setting be overridden per call. Uses the same endpoint and pcm_24000 output format
as the exhibition streaming path, so what lands here is what Unreal ingests.

Usage:
  python tools/capture_voice_sample.py <label> [key=value ...]
    keys: voice_id, model_id, stability, similarity_boost, style, speed, speaker_boost, text

Writes tools/voice-samples/<label>.wav
"""
from __future__ import annotations

import json
import sys
import urllib.request
import wave
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = Path(__file__).resolve().parent / "voice-samples"
SAMPLE_RATE = 24000
DEFAULT_TEXT = "The boat struck the reef at dusk, and the water took her down before dawn."


def load_env() -> dict[str, str]:
    values: dict[str, str] = {}
    for line in (REPO_ROOT / ".env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip()
    return values


def main() -> None:
    args = sys.argv[1:]
    if not args:
        raise SystemExit(__doc__)
    label = args[0]
    overrides = dict(pair.split("=", 1) for pair in args[1:] if "=" in pair)

    env = load_env()
    api_key = env.get("ELEVENLABS_API_KEY", "")
    if not api_key:
        raise SystemExit("ELEVENLABS_API_KEY missing from .env")

    voice_id = overrides.get("voice_id", env.get("ELEVENLABS_VOICE_ID", ""))
    text = overrides.get("text", DEFAULT_TEXT)
    voice_settings = {
        "stability": float(overrides.get("stability", env.get("ELEVENLABS_STABILITY", 0.4))),
        "similarity_boost": float(overrides.get("similarity_boost", env.get("ELEVENLABS_SIMILARITY_BOOST", 0.8))),
        "style": float(overrides.get("style", env.get("ELEVENLABS_STYLE", 0.3))),
        "speed": float(overrides.get("speed", env.get("ELEVENLABS_SPEED", 0.88))),
        "use_speaker_boost": str(overrides.get("speaker_boost", env.get("ELEVENLABS_SPEAKER_BOOST", "true"))).lower()
        != "false",
    }
    payload = {
        "text": text,
        "model_id": overrides.get("model_id", env.get("ELEVENLABS_MODEL_ID", "eleven_turbo_v2_5")),
        "voice_settings": voice_settings,
    }

    url = (
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream"
        f"?output_format=pcm_{SAMPLE_RATE}&optimize_streaming_latency=4"
    )
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"xi-api-key": api_key, "Content-Type": "application/json", "Accept": "audio/pcm"},
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        pcm = response.read()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / f"{label}.wav"
    with wave.open(str(out_path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        handle.writeframes(pcm)

    print(f"{label}: voice={voice_id} settings={voice_settings} bytes={len(pcm)} -> {out_path}")


if __name__ == "__main__":
    main()
