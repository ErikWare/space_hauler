#!/usr/bin/env python3
"""Strip black backgrounds from planet surface sprites.

Run AFTER planet_gen.py:
    python3 planet_remove_bg.py

Uses brightness-threshold + feather, same algorithm as remove_bg.py.
Do NOT re-run on already-processed sprites — the feather pass is not idempotent.
"""
import pathlib
import numpy as np
from PIL import Image

HERE = pathlib.Path(__file__).parent

# (filename, hard_threshold, feather_end)
# hard=40, feather=80 is standard.
# For dark subjects (shadows, dark green trees), use hard=25, feather=60.
TARGETS = [
    ("planet_tree.png",         30, 70),   # dark green canopy — strict cut
    ("planet_bush.png",         30, 65),
    ("planet_pine.png",         30, 70),
    ("planet_rock.png",         35, 75),
    ("planet_mountain.png",     35, 75),
    ("planet_barn.png",         40, 80),
    ("planet_market.png",       40, 80),
    ("planet_house.png",        40, 80),
    ("planet_windmill.png",     40, 80),
    ("planet_well.png",         40, 80),
    ("planet_launchpad.png",    40, 80),
    ("planet_rocket.png",       40, 80),
    ("planet_player.png",       40, 80),
    ("planet_farmer.png",       40, 80),
    ("planet_merchant.png",     40, 80),
    ("planet_flower_patch.png", 35, 70),
    ("planet_crop_row.png",     30, 65),
    ("planet_fence.png",        35, 75),
]


def remove_bg(path: pathlib.Path, hard: int, feather_end: int) -> None:
    if not path.exists():
        print(f"  ⚠  skip (not found): {path.name}")
        return

    img = Image.open(path).convert("RGBA")
    arr = np.array(img, dtype=np.float32)

    r, g, b, a = arr[..., 0], arr[..., 1], arr[..., 2], arr[..., 3]
    brightness = np.maximum(np.maximum(r, g), b)

    factor = np.clip((brightness - hard) / max(feather_end - hard, 1), 0.0, 1.0)
    arr[..., 3] = (a * factor).clip(0, 255)

    out = Image.fromarray(arr.astype(np.uint8), "RGBA")
    out.save(path)
    removed = int(np.sum(factor < 0.5))
    total   = arr.shape[0] * arr.shape[1]
    print(f"  ✅ {path.name:40s}  hard={hard:3d} feather={feather_end:3d}  "
          f"removed {removed:7,}/{total:7,} px ({100*removed/total:.1f}%)")


def main():
    print("Stripping black backgrounds from planet sprites…\n")
    for fname, hard, feather in TARGETS:
        remove_bg(HERE / fname, hard, feather)
    print("\nDone.")


if __name__ == "__main__":
    main()
