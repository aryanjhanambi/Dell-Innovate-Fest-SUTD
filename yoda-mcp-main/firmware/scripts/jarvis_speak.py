#!/usr/bin/env python3
"""
jarvis_speak.py -- laptop voice for the Jarvis pendant.

Built when the necklace's own speaker was not producing sound. It stays useful
as a demo fallback even once on-device audio works, because the
firmware still prints every sentence Jarvis speaks to the USB serial as
    I (12345) Application: << <what Jarvis says>
and every user utterance as
    I (12345) Application: >> <what the senior said>
(see xiaozhi-esp32/main/application.cc:544 / :553).

This script REPLACES your serial monitor: it reads COM5, prints the log so you
still see everything, and speaks each `<<` sentence out loud through the LAPTOP
speaker using a fast cloud TTS (Cartesia by default, ElevenLabs optional).

  necklace mic -> cloud thinks -> Jarvis's words come down USB -> laptop speaks

No firmware/cloud change -- the bridge only reads what the device already emits.
If TTS ever fails, the log still prints, so nothing hard-breaks.

Usage:
    python jarvis_speak.py                       # tap COM5, speak Jarvis (Cartesia)
    python jarvis_speak.py --backend elevenlabs
    python jarvis_speak.py --port COM6
    python jarvis_speak.py --test "Hello Madam Tan, how are you feeling today?"
    python jarvis_speak.py --list-voices

Config (put keys in yoda-mcp/.env or the environment):
    CARTESIA_API_KEY=...          (default backend)
    ELEVENLABS_API_KEY=...        (--backend elevenlabs)
    JARVIS_TTS=cartesia|elevenlabs   (default backend; --backend overrides)
    JARVIS_VOICE_ID=...           (optional; overrides the per-backend default voice)
    JARVIS_TTS_MODEL=...          (optional; default sonic-2 / eleven_flash_v2_5)
"""
import argparse
import os
import queue
import re
import sys
import threading
import time
import warnings

warnings.filterwarnings("ignore", category=DeprecationWarning)  # keep the terminal clean

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# --- load API keys from yoda-mcp/.env (gitignored) ---
_HERE = os.path.dirname(os.path.abspath(__file__))
_ENV = os.path.join(_HERE, "yoda-mcp", ".env")
try:
    from dotenv import load_dotenv
    load_dotenv(_ENV)
except Exception:
    pass

# strip ANSI colour codes the ESP-IDF console may wrap log lines in
_ANSI = re.compile(r"\x1b\[[0-9;]*m")
# Jarvis TTS sentence / user ASR text, as they appear after the "Application:" tag
_SAY = re.compile(r"<<\s?(.+)")
_HEARD = re.compile(r">>\s?(.+)")

_ELEVEN_DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"   # "Rachel" -- a stock public voice
_CARTESIA_FALLBACK_VOICE = "a0e99841-438c-4a64-b679-ae501e7d6091"

_clients = {}


def _cartesia():
    if "cartesia" not in _clients:
        from cartesia import Cartesia
        key = os.environ.get("CARTESIA_API_KEY")
        if not key:
            raise RuntimeError("CARTESIA_API_KEY not set -- add it to yoda-mcp/.env")
        _clients["cartesia"] = Cartesia(api_key=key)
    return _clients["cartesia"]


def _elevenlabs():
    if "elevenlabs" not in _clients:
        from elevenlabs.client import ElevenLabs
        key = os.environ.get("ELEVENLABS_API_KEY")
        if not key:
            raise RuntimeError("ELEVENLABS_API_KEY not set -- add it to yoda-mcp/.env")
        _clients["elevenlabs"] = ElevenLabs(api_key=key)
    return _clients["elevenlabs"]


def list_voices(backend):
    """Return [(voice_id, name), ...] for the active backend (best-effort)."""
    out = []
    if backend == "cartesia":
        for v in _cartesia().voices.list():
            vid = getattr(v, "id", None) or (v.get("id") if isinstance(v, dict) else None)
            name = getattr(v, "name", "") or (v.get("name", "") if isinstance(v, dict) else "")
            if vid:
                out.append((vid, name))
    else:
        res = _elevenlabs().voices.get_all()
        for v in getattr(res, "voices", []):
            out.append((getattr(v, "voice_id", "?"), getattr(v, "name", "")))
    return out


def resolve_voice(backend, explicit):
    if explicit:
        return explicit
    if backend == "elevenlabs":
        return _ELEVEN_DEFAULT_VOICE
    # cartesia: auto-pick a voice that actually exists on this account
    print("[voice] looking up a Cartesia voice (set JARVIS_VOICE_ID in .env to skip this)...", flush=True)
    try:
        voices = list_voices("cartesia")
        if voices:
            print(f"[voice] using Cartesia voice {voices[0][1]!r} ({voices[0][0]})  "
                  f"-- pin it with JARVIS_VOICE_ID to lock it")
            return voices[0][0]
    except Exception as e:
        print(f"[warn] couldn't list Cartesia voices ({e}); falling back to a default id")
    return _CARTESIA_FALLBACK_VOICE


def synth(backend, text, voice_id, model):
    """Return (sample_rate, dtype, iterator-of-raw-PCM-bytes) for `text`."""
    if backend == "cartesia":
        sr = 44100
        resp = _cartesia().tts.generate(
            model_id=model or "sonic-2",
            transcript=text,
            voice={"mode": "id", "id": voice_id},
            language="en",
            output_format={"container": "raw", "encoding": "pcm_s16le", "sample_rate": sr},
        )
        return sr, "int16", resp.iter_bytes()
    else:
        sr = 24000
        it = _elevenlabs().text_to_speech.convert(
            voice_id=voice_id,
            text=text,
            model_id=model or "eleven_flash_v2_5",
            output_format="pcm_24000",
        )
        return sr, "int16", it


def play(sr, dtype, chunks):
    """Stream raw-PCM byte chunks to the default speaker as they arrive."""
    import sounddevice as sd
    frame = {"int16": 2, "float32": 4}[dtype]  # mono
    leftover = b""
    stream = sd.RawOutputStream(samplerate=sr, channels=1, dtype=dtype)
    stream.start()
    try:
        for chunk in chunks:
            if not chunk:
                continue
            buf = leftover + bytes(chunk)
            n = len(buf) - (len(buf) % frame)
            if n:
                stream.write(buf[:n])
            leftover = buf[n:]
        if leftover:
            stream.write(leftover + b"\x00" * (frame - len(leftover)))
    finally:
        stream.stop()
        stream.close()


def speaker_loop(q, backend, voice_id, model):
    while True:
        text = q.get()
        if text is None:
            return
        try:
            sr, dtype, chunks = synth(backend, text, voice_id, model)
            play(sr, dtype, chunks)
        except Exception as e:
            print(f"[tts error] {e}  (text still shown above)")
        finally:
            q.task_done()


def open_serial(port):
    import serial
    for _ in range(40):  # retry ~10s to survive USB re-enumeration after a reset
        try:
            return serial.Serial(port, 115200, timeout=0.2)
        except Exception:
            time.sleep(0.25)
    return None


def tap_serial(port, q):
    ser = open_serial(port)
    if ser is None:
        print(f"could not open {port} -- is a serial monitor (pio/idf) still holding it? close it and retry.")
        sys.exit(1)
    ser.reset_input_buffer()
    print(f"[jarvis_speak] tapping {port} @115200 -- talk to the necklace; Jarvis speaks on this laptop. Ctrl-C to stop.\n")
    buf = ""
    try:
        while True:
            data = ser.read(4096)
            if not data:
                continue
            buf += data.decode("utf-8", "replace")
            while "\n" in buf:
                line, buf = buf.split("\n", 1)
                line = _ANSI.sub("", line).rstrip("\r")
                if not line:
                    continue
                print(line)
                sys.stdout.flush()
                m = _SAY.search(line)
                if m:
                    said = m.group(1).strip()
                    # skip tool-call markers the cloud emits as "<< % get_senior_profile..."
                    if said and not said.startswith("%"):
                        q.put(said)
    except KeyboardInterrupt:
        print("\n[jarvis_speak] stopped.")
    finally:
        ser.close()


def main():
    ap = argparse.ArgumentParser(description="Speak the Jarvis pendant's replies through the laptop speaker.")
    ap.add_argument("--port", default=os.environ.get("JARVIS_PORT", "COM5"))
    ap.add_argument("--backend", default=os.environ.get("JARVIS_TTS", "cartesia"),
                    choices=["cartesia", "elevenlabs"])
    ap.add_argument("--voice", default=os.environ.get("JARVIS_VOICE_ID"))
    ap.add_argument("--model", default=os.environ.get("JARVIS_TTS_MODEL"))
    ap.add_argument("--test", metavar="TEXT", help="speak one sentence and exit (no serial)")
    ap.add_argument("--list-voices", action="store_true", help="print available voice ids and exit")
    args = ap.parse_args()

    if args.list_voices:
        for vid, name in list_voices(args.backend):
            print(f"{vid}  {name}")
        return

    voice_id = resolve_voice(args.backend, args.voice)
    print(f"[jarvis_speak] backend={args.backend} voice={voice_id}")

    if args.test:
        sr, dtype, chunks = synth(args.backend, args.test, voice_id, args.model)
        play(sr, dtype, chunks)
        return

    q = queue.Queue()
    threading.Thread(target=speaker_loop, args=(q, args.backend, voice_id, args.model),
                     daemon=True).start()
    tap_serial(args.port, q)


if __name__ == "__main__":
    main()
