#!/usr/bin/env python3
"""Make the solid-black space background of in-world sprites transparent.

The AI-generated PNGs are 1280x720 hero shots on a pure-black backdrop. Drawn on
the game canvas (which has its own starfield) the black rectangle reads as an
ugly box, so we knock the black out to alpha 0 and feather the near-black rim so
the ship/station edge doesn't get a hard cut.

Only the sprites that actually FLOAT in the game world are processed here; the
fullscreen overlays (opening/victory/nebula/portrait scenes) keep their black
backing on purpose and are left untouched.

Per-pixel rule (brightness = max(R,G,B), which is exactly the "R<t AND G<t AND
B<t" test the brief asks for, since max<t <=> all three channels < t):
    factor = clip((brightness - hard) / (feather_end - hard), 0, 1)
    alpha *= factor
  -> brightness < hard        : factor 0   -> fully transparent (pure black gone)
  -> hard <= b < feather_end   : smooth 0..1 ramp -> feathered rim, no hard edge
  -> brightness >= feather_end : factor 1   -> pixel untouched (the subject)
Using a continuous ramp (rather than a fixed alpha*brightness/feather_end) avoids
a discontinuity at `hard`, which is the whole point of feathering.

nox_phantom is a translucent purple-black hull: a very strict hard cut (30) so
only pure black is removed, and a tight feather band so the purple body (B>30) is
preserved rather than dimmed.
"""
import os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))

# (filename, hard_threshold, feather_end)
STANDARD = (40, 80)
NOX = (30, 40)  # strict: keep the translucent purple body (B>30), drop pure black

TARGETS = [
    ("vulture_tug.png", *STANDARD),
    ("atlas_freighter.png", *STANDARD),
    ("aegis_battlecruiser.png", *STANDARD),
    ("vex_fighter.png", *STANDARD),
    ("krag_raider.png", *STANDARD),
    ("nox_phantom.png", *NOX),
    ("companion_drone.png", *STANDARD),
    ("station_vex.png", *STANDARD),
    ("station_krag.png", *STANDARD),
    ("station_nox.png", *STANDARD),
    ("outpost_player.png", *STANDARD),
    ("outpost_enemy.png", *STANDARD),
    ("asteroid_ore.png", *STANDARD),
    ("junk_can.png", *STANDARD),
    ("junk_panel.png", *STANDARD),
    ("junk_crate.png", *STANDARD),
    ("junk_debris.png", *STANDARD),
    ("warp_gate.png", *STANDARD),
    ("icon_vex.png", *STANDARD),
    ("icon_krag.png", *STANDARD),
    ("icon_nox.png", *STANDARD),
    ("vulture_tug_menu.png", *STANDARD),
    ("atlas_freighter_menu.png", *STANDARD),
    ("aegis_battlecruiser_menu.png", *STANDARD),
]


def process(path, hard, feather_end):
    im = Image.open(path).convert("RGBA")
    arr = np.array(im, dtype=np.float32)
    rgb = arr[..., :3]
    brightness = rgb.max(axis=2)
    factor = np.clip((brightness - hard) / float(feather_end - hard), 0.0, 1.0)
    arr[..., 3] *= factor
    out = Image.fromarray(arr.astype(np.uint8), "RGBA")
    out.save(path, "PNG")

    a = arr[..., 3]
    total = a.size
    gone = int((a < 1).sum())
    feathered = int(((a >= 1) & (a < 254)).sum())
    kept = int((a >= 254).sum())
    return total, gone, feathered, kept


def main():
    print(f"{'sprite':32} {'transparent':>12} {'feathered':>10} {'opaque':>10}  removed%")
    print("-" * 82)
    for name, hard, fend in TARGETS:
        path = os.path.join(HERE, name)
        if not os.path.exists(path):
            print(f"{name:32}  MISSING — skipped")
            continue
        total, gone, feathered, kept = process(path, hard, fend)
        pct = 100.0 * gone / total
        tag = "  (nox strict)" if fend == NOX[1] else ""
        print(f"{name:32} {gone:12,} {feathered:10,} {kept:10,}  {pct:5.1f}%{tag}")
    print("-" * 82)
    print("done — all saved as RGBA PNG in place")


if __name__ == "__main__":
    main()
