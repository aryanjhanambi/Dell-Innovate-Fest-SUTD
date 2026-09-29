# Pendant firmware

A XIAO ESP32-S3 Sense running the [xiaozhi-esp32](https://github.com/78/xiaozhi-esp32) voice
stack, plus a custom board (`yoda-pendant`) that adds the caregiver welfare check.

This folder is an **overlay, not a full firmware tree**. Upstream is ~18k files of MIT code, and
vendoring it here would bury the part that is actually ours. So this holds only our files, applied
onto a clean upstream checkout.

## What's ours

| Path | What it is |
|------|------------|
| `yoda-pendant/config.h` | Pin map: I2S speaker (MAX98357A), PDM mic, camera, boot button, cloud relay config |
| `yoda-pendant/config.json` | Build target and sdkconfig (8 MB flash, EN_US, "Jarvis" wake word) |
| `yoda-pendant/yoda_pendant_board.cc` | The board: voice stack, LAN HTTP server, and the cloud relay loop |
| `assets/checking.ogg` | "We're checking on you now" privacy announce, played before the camera arms |
| `assets/door.ogg` | Legacy ping announce |
| `patches/esp32_camera.{h,cc}.patch` | Adds `CaptureToJpeg` and a lean `CaptureJpegStream` for MJPEG |
| `patches/CMakeLists.txt.patch` | Registers `BOARD_TYPE_YODA_PENDANT` |
| `patches/Kconfig.projbuild.patch` | Adds the board to the menuconfig list |
| `scripts/` | Build, flash and serial helpers (Windows) |

## Hardware

XIAO ESP32-S3 Sense: onboard camera (OV2640 or OV3660 depending on the batch, same Seeed pinout),
onboard PDM mic, 2.4 GHz WiFi, USB-CDC.

**MAX98357A I2S amp.** Note the silk labels on the XIAO are not GPIO numbers:

| Amp pin | GPIO | XIAO pad | Notes |
|---------|------|----------|-------|
| LRC / WS | 1 | D0 | |
| BCLK | 2 | D1 | |
| DIN | 3 | D2 | |
| VIN | | 3V3 | |
| GND | | GND | must share ground with the XIAO |
| SD | | *(see below)* | shutdown + channel select, not optional |
| GAIN | | *(leave floating)* | floating gives the default gain |

These three GPIOs are the ones the board actually drives, so they have to match however the amp is
physically wired. If you rewire it, change `config.h` to suit, not the other way round.

**The SD pin is the one that bites you.** It is not just an on/off pin, it also picks the channel, and
the chip reads it as an analog voltage:

- Near 0 V (below ~0.16 V) the amp is in **full shutdown**. I2S keeps streaming, the ESP32 logs look
  perfect, and the speaker is completely silent. This is the classic false alarm: it looks like a
  software bug and it is not.
- Above roughly 1.4 V it plays the **left** channel. Mid voltages select right or a L+R mix.

Most of these breakouts have a pull-up so SD floats high on its own. Do not assume it. If there is any
doubt, jumper **SD to VIN** and the amp is forced awake on the left channel. The firmware sends the
same mono audio on both slots (`I2S_STD_SLOT_BOTH` in `yoda_pendant_board.cc`), so whichever channel
SD selects, there is audio in it.

**Speaker wiring.** The speaker's two wires go under the screws of the green terminal. If your speaker
came with a JST plug on the end, that plug does **not** mate with a screw terminal. Cut it off, strip
the wires, and clamp bare copper under the screws. A plug resting against the terminal reads as
"connected" by eye and passes no current.

PDM mic is on GPIO 42 (clock) and 41 (data). Wake word is "Jarvis", the stock WakeNet
`wn9_jarvis_tts` model. "Yoda" would need Espressif's paid custom training.

### Silent speaker, healthy logs

If the serial log reaches `State: speaking` and prints `<< ...` lines with no `EspUdp` or `MQTT`
errors, the whole software path is fine: mic, ASR, LLM, TTS and audio transport all worked. That says
nothing about which physical pins the audio is leaving on, or what happens after the amp. Work down
this list, in order:

1. **Pin map mismatch.** The three GPIOs above must match how the amp is actually wired. If they
   don't, the chip clocks I2S out of pins with nothing attached and every log line still looks
   perfect. Check this before touching the hardware.
2. **SD pin** at 0 V or floating low, so the amp is shut down (see above).
3. **Speaker not actually clamped** in the screw terminal (see above).
4. **Ground not common** between amp and XIAO.
5. **No power on VIN.**
6. **Blown speaker.** A 1 W driver run at high volume dies quickly, so keep the volume low while
   testing.

A useful splitter: with the amp powered, briefly tap the `DIN` pin to 3.3 V and back. A live amp and a
live speaker will click or pop audibly. Clicks mean the analog side is fine and the problem is
upstream. No clicks at all means the amp is asleep, unpowered, or not connected to the speaker.

## Two ways the caregiver reaches the necklace

**Cloud relay (the one that matters).** The necklace polls the deployed dashboard for pending
commands and pushes JPEG frames back up, both outbound over HTTPS. No port forwarding, no LAN
discovery, no public IP. It works on a mobile hotspot. Configured by `YODA_CLOUD_BASE` /
`YODA_DEVICE_TOKEN` in `config.h`, hitting `/api/device/poll` and `/api/device/frame`.

The idle poll is deliberately slow (15 s). A faster poll means a fresh TLS handshake every cycle,
which starves the on-chip wake-word detector of CPU and stops "Jarvis" triggering at all. That bug
cost a while to find, so the interval is load-bearing, not arbitrary.

**LAN HTTP server (fallback).** Kept for same-WiFi debugging.

| Endpoint | Effect |
|----------|--------|
| `GET /ping` | Beep and announce, asking her to respond |
| `GET /camera/on` | Privacy announce, then arm the camera |
| `GET /capture` | One JPEG still, only when armed |
| `GET /stream` | Live MJPEG until the client disconnects |
| `GET /camera/off` | Disarm, stream loop exits |

Camera frames are gated behind `/camera/on` by design. The caregiver cannot see anything until the
necklace has said out loud that it is turning on.

## Build from scratch

Needs ESP-IDF v5.5.x (built against 5.5.2).

```powershell
git clone https://github.com/78/xiaozhi-esp32.git
cd xiaozhi-esp32
powershell -File ..\yoda-mcp\firmware\apply-overlay.ps1 -XiaozhiRoot .
python scripts\release.py yoda-pendant
```

The wake word and 8 MB flash config come from `config.json`'s `sdkconfig_append`, so a clean build
is already set to Jarvis with no manual menuconfig.

```powershell
idf.py -p COM5 flash        # COM5 is single-access, close any serial monitor first
pio device monitor -p COM5 -b 115200
```

On boot the log prints the device's LAN IP for the fallback path:
`=== JARVIS WELFARE: device IP = 10.x.x.x ===`

> The `scripts/*.bat` helpers hard-code local paths (ESP-IDF under `C:\Users\...`). They are
> committed as a record of how this machine builds. Edit the paths for another environment, or use
> the raw `idf.py` commands above.
