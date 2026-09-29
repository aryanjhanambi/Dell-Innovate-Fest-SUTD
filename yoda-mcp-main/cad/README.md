# Pendant case (XIAO ESP32-S3 Sense)

Parametric enclosure, printed in two parts. Every dimension is a number at the top of
`pendant_case.py`, so a bad test fit is a one-line change and a re-run, not a CAD session.

## Files

`pendant_case.py` is the model. It writes `pendant_base` and `pendant_lid` as both `.stl`
(slice these) and `.step` (edit these). `viewer.html` is a three.js preview, `preview.png`
is a static render.

## Regenerate

```bash
cd yoda-mcp
cad/.venv/Scripts/python.exe cad/pendant_case.py
```

Exports are vertex-merged and watertight-checked on the way out. A non-manifold edge fails
loudly here instead of halfway through a slicer.

## Preview in a browser

```bash
cd yoda-mcp/cad
.venv/Scripts/python.exe -m http.server 8000
# open http://localhost:8000/viewer.html
```

## What it holds

Interior 26 x 36 x 26 mm, outer 30 x 31 x 40 mm. That fits the XIAO ESP32-S3 Sense stack
(21 x 17.8 x 15), a 30 x 20 x 4.2 speaker, and a MAX98357 amp, stacked front to back.

The lid closes on a mid-wall spigot lip plus two diagonal M2 screws. The lip sits in the
middle of the wall rather than flush with the cavity, which keeps it clear of the screw
bosses and avoids the coincident faces that produce non-manifold geometry.

Camera hole is 7 mm (6 mm lens plus clearance), placed high so it clears the lanyard boss.
Three 2 mm holes below it vent the speaker and double as the mic opening. USB-C exits the
bottom edge.

## Printing

PLA, 0.2 mm layers, 3 walls, 15% infill. No supports needed: print the tub open side up and
the lid face down. Two M2 self-tapping screws, 6 to 8 mm.

## Tuning after a test fit

| Symptom | Parameter |
|---|---|
| Board will not drop in, or rattles | `BAYS["compact"]`, `WALL` |
| Camera hole misaligned | `CAM_OFF_X` (right is +), `CAM_OFF_Z` (up is +) |
| USB-C will not seat | `USB_OFF_X`, `USB_OFF_Y`, `USB_W`, `USB_H` |
| Lid too tight or too loose | `GROOVE_CLR` |
| Screws bind | `SCREW_CLEAR`, `SCREW_PILOT` |

`LAYOUT = "breadboard"` swaps in a larger bay if the amp is on a breadboard instead of
soldered.

## Known gaps

No board-retention ledge yet, the closed lid holds the board down. No dedicated antenna
channel either, the flat u.FL antenna tucks against an inside wall. Both are fine at this
size and worth adding once a print confirms the fit.
