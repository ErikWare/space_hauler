#!/usr/bin/env python3
"""
Template: recolor Mira clay masters into a new planet pack.

Usage:
  python3 .grok/skills/procedural-planet-creation/scripts/recolor_pack_template.py \\
      --pack myworld \\
      --regolith 150,148,155 \\
      --metal 140,155,175 \\
      --accent 80,200,255 \\
      --dark 70,68,78

Does not register the pack in sprites.js — do that after files exist.
"""
from __future__ import annotations

import argparse
import glob
import os
from pathlib import Path

from PIL import Image, ImageEnhance

ROOT = Path(__file__).resolve().parents[3]  # repo root
SRC = ROOT / "sprites" / "mira"


def parse_rgb(s: str) -> tuple[int, int, int]:
    parts = [int(x.strip()) for x in s.split(",")]
    if len(parts) != 3:
        raise ValueError(f"expected R,G,B got {s!r}")
    return parts[0], parts[1], parts[2]


def recolor_to(im: Image.Image, target: tuple[int, int, int], strength: float = 1.0) -> Image.Image:
    im = im.convert("RGBA")
    px = list(im.getdata())
    op = [c for c in px if c[3] > 40]
    if not op:
        return im
    lums = [(0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255 for c in op]
    lo, hi = min(lums), max(lums)
    span = max(0.08, hi - lo)
    tr, tg, tb = target
    out = []
    for r, g, b, a in px:
        if a < 8:
            out.append((0, 0, 0, 0))
            continue
        lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
        t = max(0.0, min(1.0, (lum - lo) / span))
        shade = 0.38 + 0.85 * t
        nr = min(255, int(tr * shade + 10 * t))
        ng = min(255, int(tg * shade + 14 * t))
        nb = min(255, int(tb * shade + 20 * t))
        if strength < 1.0:
            nr = int(r * (1 - strength) + nr * strength)
            ng = int(g * (1 - strength) + ng * strength)
            nb = int(b * (1 - strength) + nb * strength)
        out.append((nr, ng, nb, a))
    im.putdata(out)
    return im


def accent_lights(im: Image.Image, accent: tuple[int, int, int], thresh: int = 170) -> Image.Image:
    im = im.convert("RGBA")
    ar, ag, ab = accent
    out = []
    for r, g, b, a in im.getdata():
        if a < 40:
            out.append((0, 0, 0, 0))
            continue
        lum = 0.299 * r + 0.587 * g + 0.114 * b
        if lum > thresh:
            out.append((min(255, ar), min(255, ag), min(255, ab), a))
        else:
            out.append((r, g, b, a))
    im.putdata(out)
    return im


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack", required=True, help="sprites/<pack> name")
    ap.add_argument("--regolith", default="150,148,155")
    ap.add_argument("--metal", default="140,155,175")
    ap.add_argument("--accent", default="80,200,255")
    ap.add_argument("--dark", default="70,68,78")
    ap.add_argument("--crater", default="100,98,105")
    ap.add_argument("--soil", default="90,85,95")
    args = ap.parse_args()

    pal = {
        "regolith": parse_rgb(args.regolith),
        "metal": parse_rgb(args.metal),
        "accent": parse_rgb(args.accent),
        "dark": parse_rgb(args.dark),
        "crater": parse_rgb(args.crater),
        "soil": parse_rgb(args.soil),
        "warn": (255, 160, 40),
        "metal_dk": tuple(max(0, c - 40) for c in parse_rgb(args.metal)),
    }
    dest = ROOT / "sprites" / args.pack
    dest.mkdir(parents=True, exist_ok=True)

    slab_map = {
        "grass_a": "regolith",
        "grass_b": "regolith",
        "grass_c": "dark",
        "grass_flowers": "metal",
        "dirt": "crater",
        "dirt_b": "dark",
        "stone_path": "metal",
        "water": "dark",
        "soil_tilled": "soil",
        "soil_seedling": "soil",
        "soil_harvest": "soil",
    }
    for name, key in slab_map.items():
        src = SRC / f"slab_{name}.png"
        if not src.exists():
            continue
        im = recolor_to(Image.open(src), pal[key])
        if name == "stone_path":
            im = accent_lights(im, pal["accent"], 160)
        im.save(dest / f"slab_{name}.png")

    prop_map = {
        "grass_tuft_a": "regolith",
        "grass_tuft_b": "dark",
        "flower_white": "accent",
        "flower_pink": "warn",
        "pebble_cluster": "crater",
        "stone_mossy": "metal_dk",
        "bush_round": "metal",
        "reed_clump": "metal_dk",
        "stump_small": "metal_dk",
    }
    for name, key in prop_map.items():
        src = SRC / f"prop_{name}.png"
        if not src.exists():
            continue
        im = recolor_to(Image.open(src), pal[key])
        if key in ("accent", "warn", "metal"):
            im = accent_lights(im, pal["accent"], 150)
        im.save(dest / f"prop_{name}.png")
        im.transpose(Image.FLIP_LEFT_RIGHT).save(dest / f"prop_{name}_m.png")

    for src in glob.glob(str(SRC / "bldg_*.png")):
        base = os.path.basename(src)
        if base.startswith("bldg_" + args.pack + "_"):
            continue
        typ = base.replace("bldg_", "").replace(".png", "")
        im = recolor_to(Image.open(src), pal["metal"], strength=0.85)
        im = accent_lights(im, pal["accent"], 170)
        im = ImageEnhance.Color(im).enhance(0.75)
        im.save(dest / f"bldg_{args.pack}_{typ}.png")

    # features / landmarks if mira masters exist
    for name in (
        "cliff_s", "cliff_e", "cliff_n", "cliff_w",
        "peak", "boulder", "outcrop", "plant_a", "plant_b", "accent",
    ):
        src = SRC / f"feat_{name}.png"
        if not src.exists():
            continue
        key = "metal" if "cliff" in name or name == "peak" else (
            "accent" if name in ("plant_a", "accent") else "crater"
        )
        im = recolor_to(Image.open(src), pal[key])
        im.save(dest / f"feat_{name}.png")

    for name in ("mesa", "boulder", "ridge", "mountain", "volcano"):
        src = SRC / f"landmark_{name}.png"
        if not src.exists():
            continue
        im = recolor_to(Image.open(src), pal["regolith"])
        im.save(dest / f"landmark_{name}.png")

    print(f"wrote pack → {dest} ({len(list(dest.iterdir()))} files)")
    print("Next: register pack in sprites.js + PLANET_DEFS + space access.")


if __name__ == "__main__":
    main()
